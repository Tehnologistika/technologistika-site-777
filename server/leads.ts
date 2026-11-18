import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PDN } from "../shared/pdn.ts";

const DRIVE_STATUSES = new Set(["yes", "no", "uncertain"]);

export interface LeadInput {
  from: string;
  to: string;
  carModel: string;
  carYear: string | null;
  driveStatus: string;
  readyDate: string | null;
  name: string;
  phone: string;
  comment: string | null;
}

export interface StoredLead extends LeadInput {
  id: number;
  publicId: string;
  consentAt: string;
  consentText: string;
  consentTextVersion: string;
  consentDocVersion: string;
  policyVersion: string;
  cookiePolicyVersion: string;
  consentTextSha256: string;
  createdAt: string;
}

export function consentTextSha256(): string {
  return createHash("sha256")
    .update(PDN.consentCheckboxText, "utf8")
    .digest("hex");
}

export function defaultDbPath(): string {
  return path.resolve(process.cwd(), "data", "leads.sqlite");
}

export function openLeadsDb(dbPath: string): DatabaseSync {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT UNIQUE,
      from_city TEXT NOT NULL,
      to_city TEXT NOT NULL,
      car_model TEXT NOT NULL,
      car_year TEXT,
      drive_status TEXT NOT NULL,
      ready_date TEXT,
      client_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      comment TEXT,
      consent INTEGER NOT NULL CHECK (consent = 1),
      consent_at TEXT NOT NULL,
      consent_text TEXT NOT NULL,
      consent_text_version TEXT NOT NULL,
      consent_doc_version TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      cookie_policy_version TEXT NOT NULL,
      consent_text_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS leads_created_at ON leads (created_at);
  `);
  return db;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function limit(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export function parseLeadBody(
  body: unknown
):
  | { ok: true; lead: LeadInput }
  | { ok: false; status: number; error: string } {
  const data =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (data.consent !== true) {
    return {
      ok: false,
      status: 400,
      error:
        "Чтобы отправить заявку, отметьте согласие на обработку персональных данных.",
    };
  }
  if (data.consentTextVersion !== PDN.consentCheckboxVersion) {
    return { ok: false, status: 400, error: "Не удалось отправить заявку" };
  }

  const from = limit(asString(data.from), 120);
  const to = limit(asString(data.to), 120);
  const carModel = limit(asString(data.carModel), 160);
  const carYearRaw = limit(asString(data.carYear), 4);
  const driveStatus = asString(data.driveStatus) || "uncertain";
  const readyDateRaw = limit(asString(data.readyDate), 10);
  const name = limit(asString(data.name), 120);
  const phone = limit(asString(data.phone), 32);
  const commentRaw = limit(asString(data.comment), 2000);

  if (from.length < 2 || to.length < 2 || !carModel || !name || !phone) {
    return { ok: false, status: 400, error: "Не удалось отправить заявку" };
  }
  if (from.toLowerCase() === to.toLowerCase()) {
    return { ok: false, status: 400, error: "Не удалось отправить заявку" };
  }
  if (!/^[\d\s+\-()]{10,18}$/.test(phone)) {
    return { ok: false, status: 400, error: "Не удалось отправить заявку" };
  }
  if (!DRIVE_STATUSES.has(driveStatus)) {
    return { ok: false, status: 400, error: "Не удалось отправить заявку" };
  }
  if (carYearRaw && !/^(19|20)\d{2}$/.test(carYearRaw)) {
    return { ok: false, status: 400, error: "Не удалось отправить заявку" };
  }
  if (readyDateRaw && !/^\d{4}-\d{2}-\d{2}$/.test(readyDateRaw)) {
    return { ok: false, status: 400, error: "Не удалось отправить заявку" };
  }
  if (readyDateRaw) {
    const parsed = new Date(`${readyDateRaw}T00:00:00Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== readyDateRaw
    ) {
      return { ok: false, status: 400, error: "Не удалось отправить заявку" };
    }
  }

  return {
    ok: true,
    lead: {
      from,
      to,
      carModel,
      carYear: carYearRaw || null,
      driveStatus,
      readyDate: readyDateRaw || null,
      name,
      phone,
      comment: commentRaw || null,
    },
  };
}

export function saveLead(
  db: DatabaseSync,
  lead: LeadInput,
  now = new Date()
): string {
  const createdAt = now.toISOString();
  const insert = db.prepare(`
    INSERT INTO leads (
      public_id, from_city, to_city, car_model, car_year, drive_status, ready_date,
      client_name, phone, comment, consent, consent_at, consent_text,
      consent_text_version, consent_doc_version, policy_version, cookie_policy_version,
      consent_text_sha256, created_at
    ) VALUES (
      NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  const update = db.prepare("UPDATE leads SET public_id = ? WHERE id = ?");

  db.exec("BEGIN IMMEDIATE");
  try {
    const result = insert.run(
      lead.from,
      lead.to,
      lead.carModel,
      lead.carYear,
      lead.driveStatus,
      lead.readyDate,
      lead.name,
      lead.phone,
      lead.comment,
      createdAt,
      PDN.consentCheckboxText,
      PDN.consentCheckboxVersion,
      PDN.consentDocVersion,
      PDN.policyVersion,
      PDN.cookiePolicyVersion,
      consentTextSha256(),
      createdAt
    );
    const id = Number(result.lastInsertRowid);
    const publicId = `T-${String(id).padStart(4, "0")}`;
    update.run(publicId, id);
    db.exec("COMMIT");
    return publicId;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already closed */
    }
    throw err;
  }
}

export function purgeExpired(
  db: DatabaseSync,
  retentionDays: number,
  now = new Date()
): number {
  const cutoff = new Date(
    now.getTime() - retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const result = db
    .prepare("DELETE FROM leads WHERE created_at < ?")
    .run(cutoff);
  return Number(result.changes);
}

export function retentionDaysFromEnv(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 366) return 183;
  return Math.floor(parsed);
}

export function scheduleRetention(
  db: DatabaseSync,
  retentionDays: number,
  extra?: {
    days: number;
    purge: (db: DatabaseSync, days: number) => number;
    label: string;
  }
): NodeJS.Timeout {
  const run = () => {
    try {
      const removed = purgeExpired(db, retentionDays);
      if (removed > 0) console.info(`Purged ${removed} expired lead(s)`);
    } catch {
      console.error("Lead retention purge failed");
    }
    if (!extra) return;
    try {
      const removed = extra.purge(db, extra.days);
      if (removed > 0) console.info(`Purged ${removed} expired ${extra.label}`);
    } catch {
      console.error("Audit retention purge failed");
    }
  };
  run();
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  timer.unref();
  return timer;
}

interface LeadRow {
  id: number;
  public_id: string;
  from_city: string;
  to_city: string;
  car_model: string;
  car_year: string | null;
  drive_status: string;
  ready_date: string | null;
  client_name: string;
  phone: string;
  comment: string | null;
  consent_at: string;
  consent_text: string;
  consent_text_version: string;
  consent_doc_version: string;
  policy_version: string;
  cookie_policy_version: string;
  consent_text_sha256: string;
  created_at: string;
}

export function deleteLead(db: DatabaseSync, publicId: string): boolean {
  if (!/^T-\d+$/.test(publicId)) return false;
  const result = db
    .prepare("DELETE FROM leads WHERE public_id = ?")
    .run(publicId);
  return Number(result.changes) > 0;
}

function csvCell(value: string | null): string {
  const text = value ?? "";
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

/** Выгрузка для владельца. Те же поля, что в списке, без текста согласия целиком. */
export function leadsToCsv(leads: StoredLead[]): string {
  const header = [
    "publicId",
    "createdAt",
    "name",
    "phone",
    "from",
    "to",
    "carModel",
    "carYear",
    "driveStatus",
    "readyDate",
    "comment",
    "consentAt",
    "consentTextVersion",
  ];
  const lines = [header.join(",")];
  for (const lead of leads) {
    lines.push(
      [
        lead.publicId,
        lead.createdAt,
        lead.name,
        lead.phone,
        lead.from,
        lead.to,
        lead.carModel,
        lead.carYear,
        lead.driveStatus,
        lead.readyDate,
        lead.comment,
        lead.consentAt,
        lead.consentTextVersion,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function listLeads(db: DatabaseSync, limit = 500): StoredLead[] {
  const rows = db
    .prepare(
      `SELECT id, public_id, from_city, to_city, car_model, car_year, drive_status, ready_date,
              client_name, phone, comment, consent_at, consent_text, consent_text_version,
              consent_doc_version, policy_version, cookie_policy_version, consent_text_sha256, created_at
       FROM leads
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit) as unknown as LeadRow[];

  return rows.map(row => ({
    id: row.id,
    publicId: row.public_id,
    from: row.from_city,
    to: row.to_city,
    carModel: row.car_model,
    carYear: row.car_year,
    driveStatus: row.drive_status,
    readyDate: row.ready_date,
    name: row.client_name,
    phone: row.phone,
    comment: row.comment,
    consentAt: row.consent_at,
    consentText: row.consent_text,
    consentTextVersion: row.consent_text_version,
    consentDocVersion: row.consent_doc_version,
    policyVersion: row.policy_version,
    cookiePolicyVersion: row.cookie_policy_version,
    consentTextSha256: row.consent_text_sha256,
    createdAt: row.created_at,
  }));
}

export function tokensMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export function bearerToken(header: string | undefined): string {
  if (!header) return "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : "";
}

export function telegramEnabled(env: NodeJS.ProcessEnv): boolean {
  const flag = (env.TELEGRAM_NOTIFY ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

/**
 * Сигнал без персональных данных. Вызывать только после успешной записи в БД.
 * Возвращает skipped, если уведомление выключено или не настроено.
 */
export async function notifyTelegram(
  publicId: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch
): Promise<"sent" | "skipped" | "failed"> {
  if (!telegramEnabled(env)) return "skipped";
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = (env.TELEGRAM_LEADS_CHAT_ID ?? "").trim();
  if (!token || !chatId) {
    console.error("Telegram signal is enabled but credentials are missing");
    return "failed";
  }
  if (!/^T-\d+$/.test(publicId)) return "failed";

  const text = `Новая заявка №${publicId}, откройте админку`;
  try {
    const response = await fetchImpl(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      }
    );
    if (!response.ok) {
      console.error("Telegram signal failed with status", response.status);
      return "failed";
    }
    return "sent";
  } catch {
    console.error("Telegram signal failed");
    return "failed";
  }
}
