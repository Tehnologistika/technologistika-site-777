import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PDN } from "../shared/pdn.ts";
import { createApp } from "./app.ts";
import { runAdminCli } from "./admin-cli.ts";
import {
  PRODUCTION_POLICY,
  SESSION_COOKIE,
  applyAuditIpPepper,
  auditRetentionDaysFromEnv,
  beginSetup,
  completeSetup,
  createPendingUser,
  decodeBase32,
  formatMsk,
  hashIp,
  hashPassword,
  legacyTokenEnabled,
  listAudit,
  purgeAudit,
  totpCode,
  verifyPassword,
  writeAudit,
  type AuthPolicy,
} from "./adminAuth.ts";
import { ensureAdminSchema } from "./adminAuth.ts";
import { listLeads, openLeadsDb, saveLead } from "./leads.ts";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import type { Server } from "node:http";

const AUDIT_PEPPER = "test-audit-ip-pepper-32chars-min";
applyAuditIpPepper({ AUDIT_IP_PEPPER: AUDIT_PEPPER });

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const OWNER_PASSWORD = "owner-passphrase-1";
const STAFF_PASSWORD = "staff-passphrase-1";

const testPolicy: AuthPolicy = {
  maxFailures: 3,
  lockMs: 15 * 60 * 1000,
  ipMaxAttempts: 30,
  ipWindowMs: 15 * 60 * 1000,
  sessionMs: PRODUCTION_POLICY.sessionMs,
  setupTokenMs: PRODUCTION_POLICY.setupTokenMs,
};

test("TOTP matches RFC 6238 SHA1 vectors", () => {
  assert.equal(
    decodeBase32(RFC_SECRET)?.toString("utf8"),
    "12345678901234567890"
  );
  const vectors: Array<[number, string]> = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [seconds, code] of vectors) {
    assert.equal(totpCode(RFC_SECRET, seconds * 1000, 8), code);
    assert.equal(totpCode(RFC_SECRET, seconds * 1000, 6), code.slice(-6));
  }
  const six = totpCode(RFC_SECRET, 59_000, 6);
  assert.ok(six);
  assert.equal(
    totpCode(RFC_SECRET, 89_000, 6) === six ||
      totpCode(RFC_SECRET, 59_000, 6) === six,
    true
  );
  assert.notEqual(totpCode(RFC_SECRET, 149_000, 6), six);
});

test("Moscow audit time and scrypt password", () => {
  assert.equal(
    formatMsk(new Date("2026-11-17T21:00:00.000Z")),
    "2026-11-18 00:00:00 MSK"
  );
  const hash = hashPassword(OWNER_PASSWORD);
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(verifyPassword(OWNER_PASSWORD, hash), true);
  assert.equal(verifyPassword("wrong-passphrase", hash), false);
  assert.equal(hash.includes(OWNER_PASSWORD), false);
  assert.equal(PRODUCTION_POLICY.sessionMs, 12 * 60 * 60 * 1000);
  assert.equal(PRODUCTION_POLICY.maxFailures, 5);
  assert.equal(PRODUCTION_POLICY.lockMs, 15 * 60 * 1000);
  assert.equal(legacyTokenEnabled({}), false);
  assert.equal(legacyTokenEnabled({ ADMIN_LEGACY_TOKEN: "false" }), false);
  assert.equal(legacyTokenEnabled({ ADMIN_LEGACY_TOKEN: "1" }), false);
  assert.equal(legacyTokenEnabled({ ADMIN_LEGACY_TOKEN: "true" }), true);
});

test("roles, CSRF, lockout, replay and audit", async () => {
  const ip = "203.0.113.77";
  const { db, dbPath } = freshDb();
  let current = new Date("2026-06-01T12:00:00.000Z");
  const owner = enroll(db, "owner", "owner", OWNER_PASSWORD, current, ip);
  const staff = enroll(db, "staff", "staff", STAFF_PASSWORD, current, ip);
  saveLead(
    db,
    {
      from: "Москва",
      to: "Казань",
      carModel: "Toyota Camry",
      carYear: "2019",
      driveStatus: "yes",
      readyDate: "2026-12-01",
      name: "Иван",
      phone: "+7 900 000-00-00",
      comment: "Тестовая заявка",
    },
    current
  );

  const started = listen(
    createApp({
      db,
      env: {
        ADMIN_TOKEN: "legacy-secret",
        ADMIN_LEGACY_TOKEN: "false",
        TELEGRAM_NOTIFY: "false",
        AUDIT_IP_PEPPER: AUDIT_PEPPER,
      },
      policy: testPolicy,
      now: () => current,
    })
  );
  const { base, server } = await started;
  try {
    current = new Date(current.getTime() + 30_000);
    const ownerLogin = await login(
      base,
      "owner",
      OWNER_PASSWORD,
      owner.secret,
      current,
      ip
    );
    assert.equal(ownerLogin.response.status, 200);
    const cookie = ownerLogin.cookie;
    assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=`));
    assert.match(ownerLogin.setCookie, /HttpOnly/);
    assert.match(ownerLogin.setCookie, /Secure/);
    assert.match(ownerLogin.setCookie, /SameSite=Strict/);
    assert.match(ownerLogin.setCookie, /Path=\//);
    assert.match(ownerLogin.setCookie, /Max-Age=43200/);
    assert.doesNotMatch(ownerLogin.setCookie, /Domain=/i);
    const csrf = ownerLogin.body.csrfToken as string;
    assert.equal(typeof csrf, "string");

    const staffLogin = await login(
      base,
      "staff",
      STAFF_PASSWORD,
      staff.secret,
      current,
      "203.0.113.78"
    );
    assert.equal(staffLogin.response.status, 200);
    const staffCookie = staffLogin.cookie;
    const staffCsrf = staffLogin.body.csrfToken as string;

    const staffDelete = await send(base, "/api/admin/leads/T-0001", {
      method: "DELETE",
      cookie: staffCookie,
      csrf: staffCsrf,
      ip: "203.0.113.78",
    });
    assert.equal(staffDelete.status, 403);
    const staffExport = await send(base, "/api/admin/leads/export", {
      method: "POST",
      cookie: staffCookie,
      csrf: staffCsrf,
      ip: "203.0.113.78",
      json: {},
    });
    assert.equal(staffExport.status, 403);
    assert.equal(
      (
        await send(base, "/api/admin/users", {
          cookie: staffCookie,
          ip: "203.0.113.78",
        })
      ).status,
      403
    );
    assert.equal(
      (
        await send(base, "/api/admin/audit", {
          cookie: staffCookie,
          ip: "203.0.113.78",
        })
      ).status,
      403
    );
    assert.equal(listLeads(db).length, 1);

    const noCsrf = await send(base, "/api/admin/leads/T-0001", {
      method: "DELETE",
      cookie,
      ip,
    });
    assert.equal(noCsrf.status, 403);
    const badCsrf = await send(base, "/api/admin/leads/T-0001", {
      method: "DELETE",
      cookie,
      csrf: "not-the-token",
      ip,
    });
    assert.equal(badCsrf.status, 403);
    const evilOrigin = await send(base, "/api/admin/leads/export", {
      method: "POST",
      cookie,
      csrf,
      ip,
      json: {},
      origin: "https://evil.example",
    });
    assert.equal(evilOrigin.status, 403);
    assert.equal(listLeads(db).length, 1);

    const legacy = await send(base, "/api/admin/leads", {
      ip,
      bearer: "legacy-secret",
    });
    assert.equal(legacy.status, 401);

    const viewed = await send(base, "/api/admin/leads", { cookie, ip });
    assert.equal(viewed.status, 200);
    const exported = await send(base, "/api/admin/leads/export", {
      method: "POST",
      cookie,
      csrf,
      ip,
      json: {},
    });
    assert.equal(exported.status, 200);
    assert.match(exported.text, /T-0001/);
    assert.match(exported.text, /\+7 900 000-00-00/);
    const removed = await send(base, "/api/admin/leads/T-0001", {
      method: "DELETE",
      cookie,
      csrf,
      ip,
    });
    assert.equal(removed.status, 200);
    assert.equal(listLeads(db).length, 0);
    const injected = await send(base, "/api/admin/leads/T-0001%20OR%201%3D1", {
      method: "DELETE",
      cookie,
      csrf,
      ip,
    });
    assert.equal(injected.status, 404);

    const createdUser = await send(base, "/api/admin/users", {
      method: "POST",
      cookie,
      csrf,
      ip,
      json: { login: "night", role: "staff" },
    });
    assert.equal(createdUser.status, 201);
    const invite = createdUser.json as { code: string; setupUrl: string };
    assert.equal(invite.setupUrl.includes(invite.code), true);

    const audit = listAudit(db, 50);
    const actions = audit.map(row => row.action);
    for (const action of ["login", "view", "export", "delete", "user_create"]) {
      assert.equal(actions.includes(action), true, action);
    }
    assert.equal(actions.includes("login_failed"), false);
    const view = audit.find(
      row => row.action === "view" && row.actorLogin === "owner"
    );
    assert.ok(view);
    assert.equal(view.atMsk, formatMsk(current));
    assert.match(view.atMsk, / MSK$/);
    assert.match(view.ipHash, /^[0-9a-f]{64}$/);
    for (const row of audit) {
      assert.equal(JSON.stringify(row).includes(OWNER_PASSWORD), false);
      assert.equal(JSON.stringify(row).includes(invite.code), false);
      assert.equal(JSON.stringify(row).includes("+7 900"), false);
      assert.equal(row.ipHash.includes(ip), false);
    }
    const createRow = audit.find(row => row.action === "user_create");
    assert.equal(createRow?.actorLogin, "owner");
    assert.match(createRow?.detail ?? "", /night staff/);

    db.exec("PRAGMA wal_checkpoint(FULL)");
    const raw = readFileSync(dbPath);
    assert.equal(raw.includes(Buffer.from(ip)), false);
    assert.equal(raw.includes(Buffer.from(OWNER_PASSWORD)), false);
    assert.equal(raw.includes(Buffer.from(invite.code)), false);
    assert.equal(raw.includes(Buffer.from(AUDIT_PEPPER)), false);
    const hmac = createHmac("sha256", AUDIT_PEPPER)
      .update(ip, "utf8")
      .digest("hex");
    const bare = createHash("sha256").update(ip, "utf8").digest("hex");
    assert.equal(view.ipHash, hmac);
    assert.notEqual(view.ipHash, bare);
    assert.equal(hashIp(ip), hmac);
    assert.throws(() => hashIp(ip, "short"), /AUDIT_IP_PEPPER/);

    const selfDisable = await send(base, "/api/admin/users/1/disable", {
      method: "POST",
      cookie,
      csrf,
      ip,
      json: {},
    });
    assert.equal(selfDisable.status, 409);

    current = new Date(current.getTime() + 30_000);
    await send(base, "/api/admin/logout", {
      method: "POST",
      cookie,
      csrf,
      ip,
      json: {},
    });
    const replay = await login(
      base,
      "owner",
      OWNER_PASSWORD,
      owner.secret,
      new Date(current.getTime() - 30_000),
      ip
    );
    assert.equal(replay.response.status, 401);
    const fresh = await login(
      base,
      "owner",
      OWNER_PASSWORD,
      owner.secret,
      current,
      ip
    );
    assert.equal(fresh.response.status, 200);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failed = await login(
        base,
        "staff",
        "wrong-passphrase-1",
        staff.secret,
        current,
        "203.0.113.79"
      );
      assert.equal(failed.response.status, attempt === 2 ? 429 : 401);
    }
    const locked = await login(
      base,
      "staff",
      STAFF_PASSWORD,
      staff.secret,
      current,
      "203.0.113.79"
    );
    assert.equal(locked.response.status, 429);
    db.prepare(
      "UPDATE admin_users SET locked_until = ?, failed_attempts = 0 WHERE login = 'staff'"
    ).run("2000-01-01T00:00:00.000Z");
    current = new Date(current.getTime() + 30_000);
    const unlocked = await login(
      base,
      "staff",
      STAFF_PASSWORD,
      staff.secret,
      current,
      "203.0.113.79"
    );
    assert.equal(unlocked.response.status, 200);

    const failedAudit = listAudit(db, 20).filter(
      row => row.action === "login_failed"
    );
    assert.equal(failedAudit.length > 0, true);
    assert.equal(
      failedAudit.some(row => row.detail === "locked"),
      true
    );
    assert.match(failedAudit[0].atMsk, / MSK$/);
  } finally {
    await close(server);
    db.close();
  }
});

test("IP rate limit and legacy token", async () => {
  const { db } = freshDb();
  const now = new Date("2026-06-02T12:00:00.000Z");
  const tight: AuthPolicy = {
    ...testPolicy,
    ipMaxAttempts: 4,
    maxFailures: 10,
  };
  const { base, server } = await listen(
    createApp({
      db,
      env: {
        ADMIN_TOKEN: "legacy-secret",
        ADMIN_LEGACY_TOKEN: "true",
        TELEGRAM_NOTIFY: "false",
        AUDIT_IP_PEPPER: AUDIT_PEPPER,
      },
      policy: tight,
      now: () => now,
    })
  );
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await login(
        base,
        "missing",
        OWNER_PASSWORD,
        RFC_SECRET,
        now,
        "203.0.113.40"
      );
      assert.equal(response.response.status, 401);
    }
    const blocked = await login(
      base,
      "missing",
      OWNER_PASSWORD,
      RFC_SECRET,
      now,
      "203.0.113.40"
    );
    assert.equal(blocked.response.status, 429);
    const otherIp = await login(
      base,
      "missing",
      OWNER_PASSWORD,
      RFC_SECRET,
      now,
      "203.0.113.41"
    );
    assert.equal(otherIp.response.status, 401);

    saveLead(
      db,
      {
        from: "Тула",
        to: "Омск",
        carModel: "Лада",
        carYear: null,
        driveStatus: "uncertain",
        readyDate: null,
        name: "Пётр",
        phone: "+7 901 000-00-00",
        comment: null,
      },
      now
    );
    const allowed = await send(base, "/api/admin/leads", {
      bearer: "legacy-secret",
      ip: "198.51.100.10",
    });
    assert.equal(allowed.status, 200);
    const denied = await send(base, "/api/admin/leads/export", {
      method: "POST",
      bearer: "legacy-secret",
      ip: "198.51.100.10",
      json: {},
    });
    assert.equal(denied.status, 401);
    const legacyAudit = listAudit(db, 10).find(
      row => row.actorLogin === "legacy-token"
    );
    assert.equal(legacyAudit?.action, "view");
    assert.match(legacyAudit?.ipHash ?? "", /^[0-9a-f]{64}$/);
  } finally {
    await close(server);
    db.close();
  }
});

test("owner enrolls from the CLI link and a session expires", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "admin-cli-"));
  const dbPath = path.join(dir, "leads.sqlite");
  const stdout = collect();
  const stderr = collect();
  const code = runAdminCli(["create-owner", "cliowner"], {
    env: {
      LEADS_DB_PATH: dbPath,
      SITE_DOMAIN: "example.test",
      TELEGRAM_NOTIFY: "false",
    },
    stdout,
    stderr,
    cwd: dir,
    envFile: path.join(dir, "missing.env"),
  });
  assert.equal(code, 0);
  assert.match(stdout.text, /Пароль не задан/);
  assert.match(stdout.text, /https:\/\/example\.test\/admin\/setup#code=/);
  assert.equal(stderr.text.includes("Код:"), false);
  const setupCode =
    stdout.text
      .split("\n")
      .find(line => line.startsWith("Код: "))
      ?.slice(5)
      .trim() ?? "";
  assert.equal(setupCode.length > 20, true);
  assert.equal(stdout.text.includes(OWNER_PASSWORD), false);

  const again = runAdminCli(["create-owner", "cliowner", "extra"], {
    env: { LEADS_DB_PATH: dbPath },
    stdout: collect(),
    stderr: collect(),
    cwd: dir,
    envFile: path.join(dir, "missing.env"),
  });
  assert.equal(again, 1);

  let current = new Date("2026-07-01T09:00:00.000Z");
  const db = openLeadsDb(dbPath);
  ensureAdminSchema(db);
  const shortPolicy: AuthPolicy = { ...testPolicy, sessionMs: 60_000 };
  const { base, server } = await listen(
    createApp({
      db,
      env: {
        TELEGRAM_NOTIFY: "false",
        SITE_DOMAIN: "example.test",
        AUDIT_IP_PEPPER: AUDIT_PEPPER,
      },
      policy: shortPolicy,
      now: () => current,
    })
  );
  try {
    const started = await send(base, "/api/admin/setup/start", {
      method: "POST",
      ip: "203.0.113.50",
      json: {
        code: setupCode,
        password: OWNER_PASSWORD,
        passwordConfirm: OWNER_PASSWORD,
      },
    });
    assert.equal(started.status, 200);
    const body = started.json as { secret: string; qrSvg: string };
    assert.match(body.qrSvg, /<svg/);
    assert.doesNotMatch(body.qrSvg, /<script/i);
    const secret = body.secret.replace(/\s+/g, "");
    const totp = totpCode(secret, current.getTime());
    assert.ok(totp);
    const confirmed = await send(base, "/api/admin/setup/confirm", {
      method: "POST",
      ip: "203.0.113.50",
      json: { code: setupCode, totp },
    });
    assert.equal(confirmed.status, 200);
    assert.match(confirmed.setCookie, /HttpOnly/);
    assert.match(confirmed.setCookie, /Secure/);
    assert.match(confirmed.setCookie, /SameSite=Strict/);
    const cookie = cookiePair(confirmed.setCookie);
    const seen = await send(base, "/api/admin/leads", {
      cookie,
      ip: "203.0.113.50",
    });
    assert.equal(seen.status, 200);

    const repeat = await send(base, "/api/admin/setup/confirm", {
      method: "POST",
      ip: "203.0.113.51",
      json: { code: setupCode, totp },
    });
    assert.equal(repeat.status, 400);

    const blocked = runAdminCli(["create-owner", "cliowner"], {
      env: { LEADS_DB_PATH: dbPath },
      stdout: collect(),
      stderr: collect(),
      cwd: dir,
      envFile: path.join(dir, "missing.env"),
    });
    assert.equal(blocked, 1);

    current = new Date(current.getTime() + 61_000);
    const expired = await send(base, "/api/admin/leads", {
      cookie,
      ip: "203.0.113.50",
    });
    assert.equal(expired.status, 401);

    const page = await send(base, "/admin", {});
    assert.equal(page.status, 200);
    assert.match(page.text, /Код из приложения/);
    assert.match(
      page.text,
      /Не загружайте его в зарубежные сервисы \(Google Drive, Gmail, Telegram\)/
    );
    assert.match(page.text, /\[hidden\] \{ display: none !important; \}/);
    const policyHeader = await fetch(`${base}/admin`);
    assert.match(
      policyHeader.headers.get("content-security-policy") ?? "",
      /connect-src 'self'/
    );
    assert.equal(page.text.includes("+7"), false);
    const setupPage = await send(base, "/admin/setup", {});
    assert.match(setupPage.text, /QR-код/);

    const lead = await send(base, "/api/leads", {
      method: "POST",
      json: {
        from: "Москва",
        to: "Казань",
        carModel: "Toyota Camry",
        carYear: "2019",
        driveStatus: "yes",
        readyDate: "2026-12-01",
        name: "Иван",
        phone: "+7 916 000-00-00",
        comment: "Позвоните после 18",
        consent: true,
        consentTextVersion: PDN.consentCheckboxVersion,
      },
    });
    assert.equal(lead.status, 200);
    assert.equal((lead.json as { ok: boolean }).ok, true);
  } finally {
    await close(server);
    db.close();
  }
});

test("audit rows expire after AUDIT_RETENTION_DAYS and deletes can be replayed", () => {
  assert.equal(auditRetentionDaysFromEnv(undefined), 365);
  assert.equal(auditRetentionDaysFromEnv("0"), 365);
  assert.equal(auditRetentionDaysFromEnv("400"), 400);

  const { db, dbPath } = freshDb();
  const now = new Date("2026-11-18T00:00:00.000Z");
  writeAudit(db, {
    at: new Date("2024-01-01T00:00:00.000Z"),
    actorId: null,
    actorLogin: "owner",
    action: "view",
    detail: "old",
    ip: "203.0.113.10",
  });
  writeAudit(db, {
    at: now,
    actorId: null,
    actorLogin: "owner",
    action: "view",
    detail: "fresh",
    ip: "203.0.113.10",
  });
  assert.equal(purgeAudit(db, 365, now), 1);
  const left = listAudit(db, 10);
  assert.equal(left.length, 1);
  assert.equal(left[0].detail, "fresh");

  const publicId = saveLead(
    db,
    {
      from: "Москва",
      to: "Тула",
      carModel: "Лада",
      carYear: null,
      driveStatus: "no",
      readyDate: null,
      name: "Пётр",
      phone: "+7 900 111-11-11",
      comment: null,
    },
    now
  );
  writeAudit(db, {
    at: now,
    actorId: 1,
    actorLogin: "owner",
    action: "delete",
    detail: publicId,
    ip: "203.0.113.10",
  });
  const dir = path.dirname(dbPath);
  const listFile = path.join(dir, "deletes.txt");
  const exported = collect();
  assert.equal(
    runAdminCli(["export-deletes", "--since", "2026-11-18T00:00:00.000Z"], {
      env: { LEADS_DB_PATH: dbPath, AUDIT_IP_PEPPER: AUDIT_PEPPER },
      stdout: exported,
      stderr: collect(),
      cwd: dir,
      envFile: path.join(dir, "missing.env"),
    }),
    0
  );
  assert.equal(exported.text.trim(), publicId);
  assert.equal(exported.text.includes("900"), false);
  writeFileSync(listFile, `${publicId}\n`);
  const replayOut = collect();
  assert.equal(
    runAdminCli(["replay-deletes", listFile], {
      env: { LEADS_DB_PATH: dbPath, AUDIT_IP_PEPPER: AUDIT_PEPPER },
      stdout: replayOut,
      stderr: collect(),
      cwd: dir,
      envFile: path.join(dir, "missing.env"),
    }),
    0
  );
  assert.match(replayOut.text, /Удалено повторно: 1/);
  assert.equal(listLeads(db).length, 0);
  const refused = collect();
  assert.equal(
    runAdminCli(["replay-deletes"], {
      env: { LEADS_DB_PATH: dbPath, AUDIT_IP_PEPPER: "too-short" },
      stdout: collect(),
      stderr: refused,
      cwd: dir,
      envFile: path.join(dir, "missing.env"),
    }),
    1
  );
  assert.match(refused.text, /AUDIT_IP_PEPPER/);
  db.close();
});

function enroll(
  db: DatabaseSync,
  login: string,
  role: "owner" | "staff",
  password: string,
  when: Date,
  ip: string
): { secret: string } {
  const created = createPendingUser(db, login, role, when, testPolicy);
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("create");
  const started = beginSetup(db, created.code, password, when, ip, testPolicy);
  assert.equal(started.ok, true);
  if (!started.ok) throw new Error("begin");
  const code = totpCode(started.secret, when.getTime());
  assert.ok(code);
  const done = completeSetup(db, created.code, code, when, ip, testPolicy);
  assert.equal(done.ok, true);
  return { secret: started.secret };
}

function freshDb(): { db: DatabaseSync; dbPath: string } {
  const dbPath = path.join(
    mkdtempSync(path.join(tmpdir(), "admin-auth-")),
    "leads.sqlite"
  );
  const db = openLeadsDb(dbPath);
  ensureAdminSchema(db);
  return { db, dbPath };
}

async function listen(
  app: ReturnType<typeof createApp>
): Promise<{ base: string; server: Server }> {
  const server = createServer(app);
  await new Promise<void>(resolve =>
    server.listen(0, "127.0.0.1", () => resolve())
  );
  const address = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${address.port}`, server };
}

function close(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}

type SendOptions = {
  method?: string;
  cookie?: string;
  csrf?: string;
  ip?: string;
  bearer?: string;
  json?: unknown;
  origin?: string;
};

async function send(
  base: string,
  pathname: string,
  options: SendOptions
): Promise<{ status: number; text: string; json: unknown; setCookie: string }> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.csrf) headers["x-csrf-token"] = options.csrf;
  if (options.ip) headers["x-real-ip"] = options.ip;
  if (options.bearer) headers.authorization = `Bearer ${options.bearer}`;
  if (options.origin) headers.origin = options.origin;
  if (options.json !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(base + pathname, {
    method: options.method ?? "GET",
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
  });
  const setCookie =
    response.headers.getSetCookie?.().join("\n") ??
    response.headers.get("set-cookie") ??
    "";
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, text, json, setCookie };
}

async function login(
  base: string,
  loginName: string,
  password: string,
  secret: string,
  when: Date,
  ip: string
) {
  const totp = totpCode(secret, when.getTime());
  const response = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify({ login: loginName, password, totp }),
  });
  const setCookie = response.headers.getSetCookie?.().join("\n") ?? "";
  const body = (await response.json()) as {
    csrfToken?: string;
    error?: string;
  };
  return { response, body, setCookie, cookie: cookiePair(setCookie) };
}

function cookiePair(setCookie: string): string {
  const line = setCookie
    .split("\n")
    .find(item => item.startsWith(`${SESSION_COOKIE}=`));
  return line ? line.split(";")[0] : "";
}

function collect(): { write(chunk: string): void; text: string } {
  return {
    text: "",
    write(chunk: string) {
      this.text += chunk;
    },
  };
}
