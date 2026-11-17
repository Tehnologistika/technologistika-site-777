import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const SESSION_COOKIE = "__Host-admin_session";
export const SESSION_MS = 12 * 60 * 60 * 1000;
export const SETUP_TOKEN_MS = 24 * 60 * 60 * 1000;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_LEN = 64;
const TOTP_STEP_SEC = 30;
const TOTP_DIGITS = 6;

export type Role = "owner" | "staff";
export type UserStatus = "pending" | "active" | "disabled";

export type AuthPolicy = {
  maxFailures: number;
  lockMs: number;
  ipMaxAttempts: number;
  ipWindowMs: number;
  sessionMs: number;
  setupTokenMs: number;
};

export const PRODUCTION_POLICY: AuthPolicy = {
  maxFailures: 5,
  lockMs: 15 * 60 * 1000,
  ipMaxAttempts: 30,
  ipWindowMs: 15 * 60 * 1000,
  sessionMs: SESSION_MS,
  setupTokenMs: SETUP_TOKEN_MS,
};

export type IssuedSession = {
  token: string;
  csrfToken: string;
  expiresAt: string;
  login: string;
  role: Role;
  userId: number;
};

export type ActiveSession = {
  sessionId: number;
  userId: number;
  login: string;
  role: Role;
  csrfToken: string;
};

type AuthOk = { ok: true; session: IssuedSession };
type AuthErr = { ok: false; status: number; error: string };

type UserRow = {
  id: number;
  login: string;
  role: Role;
  status: UserStatus;
  password_hash: string | null;
  totp_secret: string | null;
  totp_last_step: number | null;
  failed_attempts: number;
  locked_until: string | null;
};

const BAD_LOGIN = "Неверный логин, пароль или код.";
const LOCKED = "Слишком много попыток. Попробуйте позже.";
const BAD_SETUP = "Ссылка недействительна или устарела.";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function ensureAdminSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS admin_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled')),
      password_hash TEXT,
      totp_secret TEXT,
      totp_last_step INTEGER,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_setup_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS admin_login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_hash TEXT NOT NULL,
      at_utc TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at_utc TEXT NOT NULL,
      at_msk TEXT NOT NULL,
      actor_id INTEGER,
      actor_login TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      ip_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS admin_login_attempts_ip ON admin_login_attempts (ip_hash, at_utc);
    CREATE INDEX IF NOT EXISTS admin_audit_id ON admin_audit (id);
  `);
}

export function formatMsk(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? "00";
  let hour = pick("hour");
  if (hour === "24") hour = "00";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${hour}:${pick("minute")}:${pick("second")} MSK`;
}

export function validateLogin(login: string): string | null {
  const normalized = login.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalized)) return null;
  return normalized;
}

export function validatePassword(password: string): string | null {
  if (password.length < 12 || password.length > 128) {
    return "Пароль должен быть от 12 до 128 символов.";
  }
  if (password.trim().length === 0)
    return "Пароль должен быть от 12 до 128 символов.";
  return null;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const cost = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(cost) || cost < SCRYPT_N || cost > 1_048_576)
    return false;
  if (!Number.isInteger(r) || r < 1 || r > 32) return false;
  if (!Number.isInteger(p) || p < 1 || p > 16) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (salt.length < 16 || expected.length !== SCRYPT_LEN) return false;
  const actual = scryptSync(password, salt, expected.length, {
    N: cost,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

let dummyHash: string | null = null;

function dummyPasswordHash(): string {
  if (!dummyHash)
    dummyHash = hashPassword(randomBytes(32).toString("base64url"));
  return dummyHash;
}

export function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] ?? 0;
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(input: string): Buffer | null {
  const text = input.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  if (!text || /[^A-Z2-7]/.test(text)) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text) {
    const index = BASE32.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function otpauthUrl(login: string, secret: string): string {
  const label = encodeURIComponent(`Tehnologistika:${login}`);
  const query = new URLSearchParams({
    secret,
    issuer: "Tehnologistika",
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

export function totpCode(
  secret: string,
  timeMs: number,
  digits = TOTP_DIGITS
): string | null {
  const key = decodeBase32(secret);
  if (!key || key.length < 10) return null;
  const counter = BigInt(Math.floor(timeMs / 1000 / TOTP_STEP_SEC));
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(counter);
  const hmac = createHmac("sha1", key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = 10 ** digits;
  return String(binary % mod).padStart(digits, "0");
}

export function matchTotp(
  secret: string,
  code: string,
  timeMs: number,
  digits = TOTP_DIGITS,
  window = 1
): number | null {
  const normalized = code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) return null;
  const step = Math.floor(timeMs / 1000 / TOTP_STEP_SEC);
  for (let delta = -window; delta <= window; delta += 1) {
    const candidate = totpCode(
      secret,
      (step + delta) * TOTP_STEP_SEC * 1000,
      digits
    );
    if (!candidate) return null;
    const left = Buffer.from(candidate);
    const right = Buffer.from(normalized);
    if (left.length === right.length && timingSafeEqual(left, right))
      return step + delta;
  }
  return null;
}

export function clientAddress(
  remoteAddress: string | undefined,
  forwarded: string | undefined
): string {
  const remote = normalizeAddress(remoteAddress ?? "");
  if (isLoopback(remote)) {
    const candidate = (forwarded ?? "").split(",")[0]?.trim() ?? "";
    if (isPlausibleIp(candidate)) return candidate;
  }
  return remote || "unknown";
}

export function legacyTokenEnabled(env: NodeJS.ProcessEnv): boolean {
  return (env.ADMIN_LEGACY_TOKEN ?? "").trim().toLowerCase() === "true";
}

export function readCookie(header: string | undefined, name: string): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return "";
}

export function sessionCookie(token: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function csrfMatches(
  expected: string,
  provided: string | undefined
): boolean {
  if (!provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function originAllowed(
  origin: string | undefined,
  host: string | undefined,
  fetchSite: string | undefined
): boolean {
  if (origin) {
    try {
      return new URL(origin).host === (host ?? "");
    } catch {
      return false;
    }
  }
  if (!fetchSite) return true;
  return fetchSite === "same-origin" || fetchSite === "none";
}

export function hashIp(db: DatabaseSync, ip: string): string {
  const pepper = ipPepper(db);
  return createHash("sha256")
    .update(pepper)
    .update("|")
    .update(ip, "utf8")
    .digest("hex");
}

export type AuditEntry = {
  at: Date;
  actorId: number | null;
  actorLogin: string;
  action: string;
  detail: string | null;
  ip: string;
};

export function writeAudit(db: DatabaseSync, entry: AuditEntry): void {
  const ipHash = hashIp(db, entry.ip);
  db.prepare(
    `INSERT INTO admin_audit (at_utc, at_msk, actor_id, actor_login, action, detail, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.at.toISOString(),
    formatMsk(entry.at),
    entry.actorId,
    clip(entry.actorLogin, 64),
    clip(entry.action, 40),
    entry.detail ? clip(entry.detail, 180) : null,
    ipHash
  );
}

export type PublicUser = {
  id: number;
  login: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
};

export function listUsers(db: DatabaseSync): PublicUser[] {
  const rows = db
    .prepare(
      `SELECT id, login, role, status, created_at
       FROM admin_users
       ORDER BY id`
    )
    .all() as unknown as Array<{
    id: number;
    login: string;
    role: Role;
    status: UserStatus;
    created_at: string;
  }>;
  return rows.map(row => ({
    id: row.id,
    login: row.login,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export type PublicAudit = {
  id: number;
  atMsk: string;
  atUtc: string;
  actorLogin: string;
  action: string;
  detail: string | null;
  ipHash: string;
};

export function listAudit(db: DatabaseSync, limit = 200): PublicAudit[] {
  const rows = db
    .prepare(
      `SELECT id, at_msk, at_utc, actor_login, action, detail, ip_hash
       FROM admin_audit
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit) as unknown as Array<{
    id: number;
    at_msk: string;
    at_utc: string;
    actor_login: string;
    action: string;
    detail: string | null;
    ip_hash: string;
  }>;
  return rows.map(row => ({
    id: row.id,
    atMsk: row.at_msk,
    atUtc: row.at_utc,
    actorLogin: row.actor_login,
    action: row.action,
    detail: row.detail,
    ipHash: row.ip_hash,
  }));
}

export function createPendingUser(
  db: DatabaseSync,
  login: string,
  role: Role,
  now: Date,
  policy: AuthPolicy
): { ok: true; userId: number; code: string } | { ok: false; error: string } {
  const normalized = validateLogin(login);
  if (!normalized)
    return {
      ok: false,
      error: "Логин: 3–32 символа, латиница, цифры, точка, _ или -.",
    };
  if (role !== "owner" && role !== "staff")
    return { ok: false, error: "Неизвестная роль." };
  const existing = findUserByLogin(db, normalized);
  if (existing && existing.status !== "pending")
    return { ok: false, error: "Такой логин уже есть." };

  const code = randomBytes(32).toString("base64url");
  const expires = new Date(now.getTime() + policy.setupTokenMs).toISOString();
  const stamp = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    let userId: number;
    if (!existing) {
      const inserted = db
        .prepare(
          `INSERT INTO admin_users (
             login, role, status, password_hash, totp_secret, totp_last_step,
             failed_attempts, locked_until, created_at, updated_at
           ) VALUES (?, ?, 'pending', NULL, NULL, NULL, 0, NULL, ?, ?)`
        )
        .run(normalized, role, stamp, stamp);
      userId = Number(inserted.lastInsertRowid);
    } else {
      userId = existing.id;
      db.prepare(
        `UPDATE admin_users
         SET password_hash = NULL, totp_secret = NULL, totp_last_step = NULL,
             failed_attempts = 0, locked_until = NULL, updated_at = ?
         WHERE id = ?`
      ).run(stamp, userId);
    }
    db.prepare("DELETE FROM admin_setup_tokens WHERE user_id = ?").run(userId);
    db.prepare(
      `INSERT INTO admin_setup_tokens (user_id, token_hash, expires_at, used_at, created_at)
       VALUES (?, ?, ?, NULL, ?)`
    ).run(userId, hashToken(code), expires, stamp);
    db.exec("COMMIT");
    return { ok: true, userId, code };
  } catch (error) {
    rollback(db);
    throw error;
  }
}

export function setupLink(code: string, env: NodeJS.ProcessEnv): string {
  const path = `/admin/setup#code=${encodeURIComponent(code)}`;
  const domain = (env.SITE_DOMAIN ?? "").trim();
  if (!domain) return path;
  return `https://${domain}${path}`;
}

export function beginSetup(
  db: DatabaseSync,
  code: string,
  password: string,
  now: Date,
  ip: string,
  policy: AuthPolicy
): { ok: true; login: string; secret: string; otpauth: string } | AuthErr {
  const limited = takeIpAttempt(db, ip, now, policy);
  if (limited) return limited;
  const passwordError = validatePassword(password);
  if (passwordError) return { ok: false, status: 400, error: passwordError };
  const found = findSetup(db, code, now);
  if (!found || found.user.status !== "pending") {
    noteAttempt(db, ip, now);
    return { ok: false, status: 400, error: BAD_SETUP };
  }

  const generated = found.user.totp_secret || generateTotpSecret();
  const passwordHash = hashPassword(password);
  db.prepare(
    `UPDATE admin_users
     SET password_hash = ?, totp_secret = COALESCE(totp_secret, ?), updated_at = ?
     WHERE id = ? AND status = 'pending'`
  ).run(passwordHash, generated, now.toISOString(), found.user.id);
  const saved = findUserById(db, found.user.id);
  const secret = saved?.totp_secret || generated;
  return {
    ok: true,
    login: found.user.login,
    secret,
    otpauth: otpauthUrl(found.user.login, secret),
  };
}

export function completeSetup(
  db: DatabaseSync,
  code: string,
  totp: string,
  now: Date,
  ip: string,
  policy: AuthPolicy
): AuthOk | AuthErr {
  const limited = takeIpAttempt(db, ip, now, policy);
  if (limited) {
    writeAudit(db, {
      at: now,
      actorId: null,
      actorLogin: "unknown",
      action: "login_failed",
      detail: "rate",
      ip,
    });
    return limited;
  }
  const found = findSetup(db, code, now);
  if (
    !found ||
    found.user.status !== "pending" ||
    !found.user.password_hash ||
    !found.user.totp_secret
  ) {
    noteAttempt(db, ip, now);
    return { ok: false, status: 400, error: BAD_SETUP };
  }
  if (isLocked(found.user, now)) {
    noteAttempt(db, ip, now);
    writeAudit(db, {
      at: now,
      actorId: found.user.id,
      actorLogin: found.user.login,
      action: "login_failed",
      detail: "locked",
      ip,
    });
    return { ok: false, status: 429, error: LOCKED };
  }
  const step = matchTotp(found.user.totp_secret, totp, now.getTime());
  if (
    step === null ||
    (found.user.totp_last_step !== null && step <= found.user.totp_last_step)
  ) {
    noteAttempt(db, ip, now);
    const outcome = registerFailure(db, found.user, now, policy);
    writeAudit(db, {
      at: now,
      actorId: found.user.id,
      actorLogin: found.user.login,
      action: "login_failed",
      detail: outcome,
      ip,
    });
    return {
      ok: false,
      status: outcome === "locked" ? 429 : 401,
      error: outcome === "locked" ? LOCKED : "Неверный код подтверждения.",
    };
  }

  const stamp = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  let session: IssuedSession;
  try {
    db.prepare(
      `UPDATE admin_users
       SET status = 'active', totp_last_step = ?, failed_attempts = 0, locked_until = NULL, updated_at = ?
       WHERE id = ? AND status = 'pending'`
    ).run(step, stamp, found.user.id);
    db.prepare(
      "UPDATE admin_setup_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL"
    ).run(stamp, found.tokenId);
    session = insertSession(
      db,
      { ...found.user, status: "active", totp_last_step: step },
      now,
      policy
    );
    db.exec("COMMIT");
  } catch (error) {
    rollback(db);
    throw error;
  }
  writeAudit(db, {
    at: now,
    actorId: found.user.id,
    actorLogin: found.user.login,
    action: "user_setup",
    detail: found.user.role,
    ip,
  });
  writeAudit(db, {
    at: now,
    actorId: found.user.id,
    actorLogin: found.user.login,
    action: "login",
    detail: null,
    ip,
  });
  return { ok: true, session };
}

export function loginUser(
  db: DatabaseSync,
  login: string,
  password: string,
  totp: string,
  now: Date,
  ip: string,
  policy: AuthPolicy
): AuthOk | AuthErr {
  const limited = takeIpAttempt(db, ip, now, policy);
  if (limited) {
    writeAudit(db, {
      at: now,
      actorId: null,
      actorLogin: actorLabel(login),
      action: "login_failed",
      detail: "rate",
      ip,
    });
    return limited;
  }

  const normalized = validateLogin(login);
  const user = normalized ? findUserByLogin(db, normalized) : undefined;
  if (!user) {
    verifyPassword(password, dummyPasswordHash());
    noteAttempt(db, ip, now);
    writeAudit(db, {
      at: now,
      actorId: null,
      actorLogin: actorLabel(login),
      action: "login_failed",
      detail: "credentials",
      ip,
    });
    return { ok: false, status: 401, error: BAD_LOGIN };
  }

  if (isLocked(user, now)) {
    noteAttempt(db, ip, now);
    writeAudit(db, {
      at: now,
      actorId: user.id,
      actorLogin: user.login,
      action: "login_failed",
      detail: "locked",
      ip,
    });
    return { ok: false, status: 429, error: LOCKED };
  }

  const passwordOk = passwordMatches(user.password_hash, password);
  const step = user.totp_secret
    ? matchTotp(user.totp_secret, totp, now.getTime())
    : null;
  const freshStep =
    step !== null &&
    (user.totp_last_step === null || step > user.totp_last_step);
  if (!passwordOk || !freshStep || user.status !== "active") {
    noteAttempt(db, ip, now);
    const outcome = registerFailure(db, user, now, policy);
    writeAudit(db, {
      at: now,
      actorId: user.id,
      actorLogin: user.login,
      action: "login_failed",
      detail: outcome,
      ip,
    });
    return {
      ok: false,
      status: outcome === "locked" ? 429 : 401,
      error: outcome === "locked" ? LOCKED : BAD_LOGIN,
    };
  }

  db.prepare(
    `UPDATE admin_users
     SET failed_attempts = 0, locked_until = NULL, totp_last_step = ?, updated_at = ?
     WHERE id = ?`
  ).run(step, now.toISOString(), user.id);
  const session = insertSession(db, user, now, policy);
  writeAudit(db, {
    at: now,
    actorId: user.id,
    actorLogin: user.login,
    action: "login",
    detail: null,
    ip,
  });
  return { ok: true, session };
}

export function readSession(
  db: DatabaseSync,
  rawToken: string,
  now: Date
): ActiveSession | null {
  if (!rawToken) return null;
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.revoked_at,
              u.id AS user_id, u.login, u.role, u.status
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(hashToken(rawToken)) as
    | {
        session_id: number;
        csrf_token: string;
        expires_at: string;
        revoked_at: string | null;
        user_id: number;
        login: string;
        role: Role;
        status: UserStatus;
      }
    | undefined;
  if (!row || row.revoked_at || row.status !== "active") return null;
  if (row.expires_at <= now.toISOString()) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    login: row.login,
    role: row.role,
    csrfToken: row.csrf_token,
  };
}

export function revokeSession(
  db: DatabaseSync,
  rawToken: string,
  now: Date
): void {
  if (!rawToken) return;
  db.prepare(
    "UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL"
  ).run(now.toISOString(), hashToken(rawToken));
}

export function setUserEnabled(
  db: DatabaseSync,
  actorId: number,
  targetId: number,
  enabled: boolean,
  now: Date
): { ok: true; login: string; role: Role } | AuthErr {
  if (!Number.isInteger(targetId) || targetId < 1)
    return { ok: false, status: 404, error: "Пользователь не найден." };
  const target = findUserById(db, targetId);
  if (!target)
    return { ok: false, status: 404, error: "Пользователь не найден." };
  if (!enabled && actorId === target.id) {
    return {
      ok: false,
      status: 409,
      error: "Нельзя отключить свою учётную запись.",
    };
  }
  if (
    !enabled &&
    target.role === "owner" &&
    target.status === "active" &&
    countActiveOwners(db) <= 1
  ) {
    return {
      ok: false,
      status: 409,
      error: "Нельзя отключить единственного владельца.",
    };
  }
  if (enabled && target.status === "pending") {
    return {
      ok: false,
      status: 409,
      error: "Пользователь ещё не завершил настройку.",
    };
  }
  if (enabled && (!target.password_hash || !target.totp_secret)) {
    return { ok: false, status: 409, error: "Учётная запись не настроена." };
  }
  const status: UserStatus = enabled ? "active" : "disabled";
  db.prepare(
    "UPDATE admin_users SET status = ?, updated_at = ? WHERE id = ?"
  ).run(status, now.toISOString(), target.id);
  if (!enabled) {
    db.prepare(
      "UPDATE admin_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL"
    ).run(now.toISOString(), target.id);
  }
  return { ok: true, login: target.login, role: target.role };
}

function insertSession(
  db: DatabaseSync,
  user: UserRow,
  now: Date,
  policy: AuthPolicy
): IssuedSession {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + policy.sessionMs).toISOString();
  db.prepare(
    `INSERT INTO admin_sessions (user_id, token_hash, csrf_token, expires_at, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL)`
  ).run(user.id, hashToken(token), csrfToken, expiresAt, now.toISOString());
  return {
    token,
    csrfToken,
    expiresAt,
    login: user.login,
    role: user.role,
    userId: user.id,
  };
}

function passwordMatches(stored: string | null, password: string): boolean {
  if (password.length > 128) {
    verifyPassword(password.slice(0, 128), dummyPasswordHash());
    return false;
  }
  if (!stored) {
    verifyPassword(password, dummyPasswordHash());
    return false;
  }
  return verifyPassword(password, stored);
}

function registerFailure(
  db: DatabaseSync,
  user: UserRow,
  now: Date,
  policy: AuthPolicy
): "locked" | "credentials" {
  const attempts = Number(user.failed_attempts) + 1;
  if (attempts >= policy.maxFailures) {
    const until = new Date(now.getTime() + policy.lockMs).toISOString();
    db.prepare(
      "UPDATE admin_users SET failed_attempts = 0, locked_until = ?, updated_at = ? WHERE id = ?"
    ).run(until, now.toISOString(), user.id);
    return "locked";
  }
  db.prepare(
    "UPDATE admin_users SET failed_attempts = ?, updated_at = ? WHERE id = ?"
  ).run(attempts, now.toISOString(), user.id);
  return "credentials";
}

function takeIpAttempt(
  db: DatabaseSync,
  ip: string,
  now: Date,
  policy: AuthPolicy
): AuthErr | null {
  const ipHash = hashIp(db, ip);
  const since = new Date(now.getTime() - policy.ipWindowMs).toISOString();
  db.prepare("DELETE FROM admin_login_attempts WHERE at_utc < ?").run(since);
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM admin_login_attempts WHERE ip_hash = ? AND at_utc >= ?"
    )
    .get(ipHash, since) as {
    n: number;
  };
  if (Number(row.n) >= policy.ipMaxAttempts)
    return { ok: false, status: 429, error: LOCKED };
  return null;
}

function noteAttempt(db: DatabaseSync, ip: string, now: Date): void {
  db.prepare(
    "INSERT INTO admin_login_attempts (ip_hash, at_utc) VALUES (?, ?)"
  ).run(hashIp(db, ip), now.toISOString());
}

function findSetup(
  db: DatabaseSync,
  code: string,
  now: Date
): { tokenId: number; user: UserRow } | null {
  if (!code || code.length < 20 || code.length > 200) return null;
  const row = db
    .prepare(
      `SELECT id, user_id, expires_at, used_at
       FROM admin_setup_tokens
       WHERE token_hash = ?`
    )
    .get(hashToken(code)) as
    | {
        id: number;
        user_id: number;
        expires_at: string;
        used_at: string | null;
      }
    | undefined;
  if (!row || row.used_at || row.expires_at <= now.toISOString()) return null;
  const user = findUserById(db, row.user_id);
  if (!user) return null;
  return { tokenId: row.id, user };
}

function findUserByLogin(db: DatabaseSync, login: string): UserRow | undefined {
  return db.prepare("SELECT * FROM admin_users WHERE login = ?").get(login) as
    | UserRow
    | undefined;
}

function findUserById(db: DatabaseSync, id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM admin_users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
}

function countActiveOwners(db: DatabaseSync): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM admin_users WHERE role = 'owner' AND status = 'active'"
    )
    .get() as { n: number };
  return Number(row.n);
}

function isLocked(user: UserRow, now: Date): boolean {
  return Boolean(user.locked_until && user.locked_until > now.toISOString());
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function ipPepper(db: DatabaseSync): Buffer {
  const existing = db
    .prepare("SELECT value FROM admin_meta WHERE key = 'ip_pepper'")
    .get() as { value: string } | undefined;
  if (existing && /^[0-9a-f]{64}$/.test(existing.value))
    return Buffer.from(existing.value, "hex");
  const created = randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO admin_meta (key, value) VALUES ('ip_pepper', ?) ON CONFLICT(key) DO NOTHING"
  ).run(created);
  const stored = db
    .prepare("SELECT value FROM admin_meta WHERE key = 'ip_pepper'")
    .get() as { value: string };
  return Buffer.from(stored.value, "hex");
}

function actorLabel(login: string): string {
  return validateLogin(login) ?? "unknown";
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function rollback(db: DatabaseSync): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    /* already closed */
  }
}

function normalizeAddress(ip: string): string {
  const trimmed = ip.trim();
  if (trimmed.toLowerCase().startsWith("::ffff:")) {
    const v4 = trimmed.slice(7);
    if (isIpv4(v4)) return v4;
  }
  return trimmed;
}

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1";
}

function isPlausibleIp(ip: string): boolean {
  return isIpv4(ip) || isIpv6(ip);
}

function isIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every(part => {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith("0")) return false;
    return Number(part) <= 255;
  });
}

function isIpv6(ip: string): boolean {
  if (ip.length > 45 || !ip.includes(":")) return false;
  return /^[0-9a-f:]+$/i.test(ip);
}
