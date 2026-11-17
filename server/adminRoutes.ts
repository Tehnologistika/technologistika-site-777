import type { Express, Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import QRCode from "qrcode";
import {
  PRODUCTION_POLICY,
  SESSION_COOKIE,
  beginSetup,
  clearSessionCookie,
  clientAddress,
  completeSetup,
  createPendingUser,
  csrfMatches,
  groupSecret,
  legacyTokenEnabled,
  listAudit,
  listUsers,
  loginUser,
  originAllowed,
  readCookie,
  readSession,
  revokeSession,
  sessionCookie,
  setUserEnabled,
  setupLink,
  writeAudit,
  type AuthPolicy,
  type ActiveSession,
} from "./adminAuth.ts";
import { adminPageHtml, setupPageHtml } from "./adminPage.ts";
import {
  bearerToken,
  deleteLead,
  leadsToCsv,
  listLeads,
  tokensMatch,
} from "./leads.ts";

export type AdminAppOptions = {
  db: DatabaseSync | null;
  env?: NodeJS.ProcessEnv;
  policy?: AuthPolicy;
  now?: () => Date;
};

export function registerAdmin(app: Express, options: AdminAppOptions): void {
  const env = options.env ?? process.env;
  const policy = options.policy ?? PRODUCTION_POLICY;
  const now = () => options.now?.() ?? new Date();
  const db = options.db;

  app.get("/admin", (_req, res) => {
    sendHtml(res, adminPageHtml());
  });

  app.get("/admin/setup", (_req, res) => {
    sendHtml(res, setupPageHtml());
  });

  app.post("/api/admin/login", (req, res) => {
    if (!prepare(res) || !allowMutation(req, res) || !dbReady(res, db)) return;
    const body = record(req.body);
    const at = now();
    const ip = clientAddress(req.socket.remoteAddress, req.header("x-real-ip"));
    try {
      const result = loginUser(
        db,
        text(body.login),
        text(body.password),
        text(body.totp),
        at,
        ip,
        policy
      );
      if (!result.ok)
        return res
          .status(result.status)
          .json({ ok: false, error: result.error });
      res.append(
        "Set-Cookie",
        sessionCookie(result.session.token, Math.floor(policy.sessionMs / 1000))
      );
      return res.json({
        ok: true,
        login: result.session.login,
        role: result.session.role,
        csrfToken: result.session.csrfToken,
      });
    } catch {
      console.error("Admin login failed");
      return res.status(500).json({ ok: false, error: "Не удалось войти." });
    }
  });

  app.post("/api/admin/setup/start", async (req, res) => {
    if (!prepare(res) || !allowMutation(req, res) || !dbReady(res, db)) return;
    const body = record(req.body);
    const password = text(body.password);
    const confirm = text(body.passwordConfirm);
    if (password !== confirm)
      return res.status(400).json({ ok: false, error: "Пароли не совпадают." });
    const at = now();
    const ip = clientAddress(req.socket.remoteAddress, req.header("x-real-ip"));
    try {
      const result = beginSetup(db, text(body.code), password, at, ip, policy);
      if (!result.ok)
        return res
          .status(result.status)
          .json({ ok: false, error: result.error });
      const qrSvg = await qrSvgFor(result.otpauth);
      return res.json({
        ok: true,
        login: result.login,
        secret: groupSecret(result.secret),
        qrSvg,
      });
    } catch {
      console.error("Admin setup failed");
      return res
        .status(500)
        .json({ ok: false, error: "Не удалось подготовить код." });
    }
  });

  app.post("/api/admin/setup/confirm", (req, res) => {
    if (!prepare(res) || !allowMutation(req, res) || !dbReady(res, db)) return;
    const body = record(req.body);
    const at = now();
    const ip = clientAddress(req.socket.remoteAddress, req.header("x-real-ip"));
    try {
      const result = completeSetup(
        db,
        text(body.code),
        text(body.totp),
        at,
        ip,
        policy
      );
      if (!result.ok)
        return res
          .status(result.status)
          .json({ ok: false, error: result.error });
      res.append(
        "Set-Cookie",
        sessionCookie(result.session.token, Math.floor(policy.sessionMs / 1000))
      );
      return res.json({
        ok: true,
        login: result.session.login,
        role: result.session.role,
        csrfToken: result.session.csrfToken,
      });
    } catch {
      console.error("Admin setup confirm failed");
      return res
        .status(500)
        .json({ ok: false, error: "Не удалось завершить настройку." });
    }
  });

  app.post("/api/admin/logout", (req, res) => {
    if (!prepare(res) || !allowMutation(req, res) || !dbReady(res, db)) return;
    const at = now();
    const token = readCookie(req.header("cookie"), SESSION_COOKIE);
    const session = readSession(db, token, at);
    if (!session) {
      res.append("Set-Cookie", clearSessionCookie());
      return res.status(401).json({ ok: false, error: "Нужно войти." });
    }
    if (!csrfOk(req, res, session)) return;
    revokeSession(db, token, at);
    writeAudit(db, {
      at,
      actorId: session.userId,
      actorLogin: session.login,
      action: "logout",
      detail: null,
      ip: clientAddress(req.socket.remoteAddress, req.header("x-real-ip")),
    });
    res.append("Set-Cookie", clearSessionCookie());
    return res.json({ ok: true });
  });

  app.get("/api/admin/session", (req, res) => {
    if (!prepare(res) || !dbReady(res, db)) return;
    const session = readSession(
      db,
      readCookie(req.header("cookie"), SESSION_COOKIE),
      now()
    );
    if (!session)
      return res.status(401).json({ ok: false, error: "Нужно войти." });
    return res.json({
      ok: true,
      login: session.login,
      role: session.role,
      csrfToken: session.csrfToken,
    });
  });

  app.get("/api/admin/leads", (req, res) => {
    if (!prepare(res) || !dbReady(res, db)) return;
    const at = now();
    const ip = clientAddress(req.socket.remoteAddress, req.header("x-real-ip"));
    const session = readSession(
      db,
      readCookie(req.header("cookie"), SESSION_COOKIE),
      at
    );
    if (session) {
      try {
        const leads = listLeads(db);
        writeAudit(db, {
          at,
          actorId: session.userId,
          actorLogin: session.login,
          action: "view",
          detail: `count=${leads.length}`,
          ip,
        });
        return res.json(leads);
      } catch {
        console.error("Failed to list leads");
        return res
          .status(500)
          .json({ ok: false, error: "Не удалось открыть список." });
      }
    }
    if (legacyAllowed(req, env)) {
      try {
        const leads = listLeads(db);
        writeAudit(db, {
          at,
          actorId: null,
          actorLogin: "legacy-token",
          action: "view",
          detail: `count=${leads.length}`,
          ip,
        });
        return res.json(leads);
      } catch {
        console.error("Failed to list leads");
        return res
          .status(500)
          .json({ ok: false, error: "Не удалось открыть список." });
      }
    }
    return res.status(401).json({ ok: false, error: "Нужно войти." });
  });

  app.delete("/api/admin/leads/:publicId", (req, res) => {
    if (!prepare(res) || !allowMutation(req, res) || !dbReady(res, db)) return;
    const at = now();
    const session = readSession(
      db,
      readCookie(req.header("cookie"), SESSION_COOKIE),
      at
    );
    if (!session)
      return res.status(401).json({ ok: false, error: "Нужно войти." });
    if (!csrfOk(req, res, session) || !ownerOnly(res, session)) return;
    const publicId = one(req.params.publicId);
    try {
      const removed = deleteLead(db, publicId);
      if (!removed)
        return res.status(404).json({ ok: false, error: "Заявка не найдена." });
      writeAudit(db, {
        at,
        actorId: session.userId,
        actorLogin: session.login,
        action: "delete",
        detail: publicId,
        ip: clientAddress(req.socket.remoteAddress, req.header("x-real-ip")),
      });
      return res.json({ ok: true });
    } catch {
      console.error("Failed to delete lead");
      return res
        .status(500)
        .json({ ok: false, error: "Не удалось удалить заявку." });
    }
  });

  app.post("/api/admin/leads/export", (req, res) => {
    if (!prepare(res) || !allowMutation(req, res) || !dbReady(res, db)) return;
    const at = now();
    const session = readSession(
      db,
      readCookie(req.header("cookie"), SESSION_COOKIE),
      at
    );
    if (!session)
      return res.status(401).json({ ok: false, error: "Нужно войти." });
    if (!csrfOk(req, res, session) || !ownerOnly(res, session)) return;
    try {
      const leads = listLeads(db);
      writeAudit(db, {
        at,
        actorId: session.userId,
        actorLogin: session.login,
        action: "export",
        detail: `count=${leads.length}`,
        ip: clientAddress(req.socket.remoteAddress, req.header("x-real-ip")),
      });
      res.set("Content-Type", "text/csv; charset=utf-8");
      res.set("Content-Disposition", 'attachment; filename="leads.csv"');
      return res.send(leadsToCsv(leads));
    } catch {
      console.error("Failed to export leads");
      return res
        .status(500)
        .json({ ok: false, error: "Не удалось выгрузить заявки." });
    }
  });

  app.get("/api/admin/users", (req, res) => {
    if (!prepare(res) || !dbReady(res, db)) return;
    const session = readSession(
      db,
      readCookie(req.header("cookie"), SESSION_COOKIE),
      now()
    );
    if (!session)
      return res.status(401).json({ ok: false, error: "Нужно войти." });
    if (!ownerOnly(res, session)) return;
    return res.json(listUsers(db));
  });

  app.post("/api/admin/users", (req, res) => {
    if (!prepare(res) || !allowMutation(req, res) || !dbReady(res, db)) return;
    const at = now();
    const session = readSession(
      db,
      readCookie(req.header("cookie"), SESSION_COOKIE),
      at
    );
    if (!session)
      return res.status(401).json({ ok: false, error: "Нужно войти." });
    if (!csrfOk(req, res, session) || !ownerOnly(res, session)) return;
    const body = record(req.body);
    const role =
      body.role === "owner" || body.role === "staff" ? body.role : null;
    if (!role)
      return res.status(400).json({ ok: false, error: "Неизвестная роль." });
    try {
      const created = createPendingUser(db, text(body.login), role, at, policy);
      if (!created.ok)
        return res.status(400).json({ ok: false, error: created.error });
      writeAudit(db, {
        at,
        actorId: session.userId,
        actorLogin: session.login,
        action: "user_create",
        detail: `${text(body.login).trim().toLowerCase()} ${role}`,
        ip: clientAddress(req.socket.remoteAddress, req.header("x-real-ip")),
      });
      return res.status(201).json({
        ok: true,
        id: created.userId,
        login: text(body.login).trim().toLowerCase(),
        role,
        setupUrl: setupLink(created.code, env),
        code: created.code,
      });
    } catch {
      console.error("Failed to create admin user");
      return res
        .status(500)
        .json({ ok: false, error: "Не удалось создать пользователя." });
    }
  });

  app.post("/api/admin/users/:id/disable", (req, res) =>
    changeUser(req, res, false)
  );
  app.post("/api/admin/users/:id/enable", (req, res) =>
    changeUser(req, res, true)
  );

  app.get("/api/admin/audit", (req, res) => {
    if (!prepare(res) || !dbReady(res, db)) return;
    const session = readSession(
      db,
      readCookie(req.header("cookie"), SESSION_COOKIE),
      now()
    );
    if (!session)
      return res.status(401).json({ ok: false, error: "Нужно войти." });
    if (!ownerOnly(res, session)) return;
    return res.json(listAudit(db));
  });

  function changeUser(req: Request, res: Response, enabled: boolean): void {
    if (!prepare(res) || !allowMutation(req, res) || !dbReady(res, db)) return;
    const at = now();
    const session = readSession(
      db,
      readCookie(req.header("cookie"), SESSION_COOKIE),
      at
    );
    if (!session) {
      res.status(401).json({ ok: false, error: "Нужно войти." });
      return;
    }
    if (!csrfOk(req, res, session) || !ownerOnly(res, session)) return;
    const targetId = Number(one(req.params.id));
    try {
      const result = setUserEnabled(db, session.userId, targetId, enabled, at);
      if (!result.ok) {
        res.status(result.status).json({ ok: false, error: result.error });
        return;
      }
      writeAudit(db, {
        at,
        actorId: session.userId,
        actorLogin: session.login,
        action: enabled ? "user_enable" : "user_disable",
        detail: `${result.login} ${result.role}`,
        ip: clientAddress(req.socket.remoteAddress, req.header("x-real-ip")),
      });
      res.json({ ok: true });
    } catch {
      console.error("Failed to update admin user");
      res
        .status(500)
        .json({ ok: false, error: "Не удалось изменить пользователя." });
    }
  }
}

function prepare(res: Response): boolean {
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Frame-Options", "DENY");
  return true;
}

function sendHtml(res: Response, html: string): void {
  prepare(res);
  res.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
  res.type("html").send(html);
}

function allowMutation(req: Request, res: Response): boolean {
  if (
    originAllowed(
      req.header("origin"),
      req.header("host"),
      req.header("sec-fetch-site")
    )
  )
    return true;
  res.status(403).json({ ok: false, error: "Запрос отклонён." });
  return false;
}

function dbReady(res: Response, db: DatabaseSync | null): db is DatabaseSync {
  if (db) return true;
  res.status(503).json({ ok: false, error: "Админка не настроена." });
  return false;
}

function csrfOk(req: Request, res: Response, session: ActiveSession): boolean {
  if (csrfMatches(session.csrfToken, req.header("x-csrf-token"))) return true;
  res.status(403).json({ ok: false, error: "Запрос отклонён." });
  return false;
}

function ownerOnly(res: Response, session: ActiveSession): boolean {
  if (session.role === "owner") return true;
  res.status(403).json({ ok: false, error: "Недостаточно прав." });
  return false;
}

function legacyAllowed(req: Request, env: NodeJS.ProcessEnv): boolean {
  if (!legacyTokenEnabled(env)) return false;
  const expected = (env.ADMIN_TOKEN ?? "").trim();
  const provided = bearerToken(req.header("authorization"));
  return Boolean(expected && provided && tokensMatch(provided, expected));
}

function record(body: unknown): Record<string, unknown> {
  return body && typeof body === "object"
    ? (body as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function qrSvgFor(otpauth: string): Promise<string> {
  return new Promise((resolve, reject) => {
    QRCode.toString(
      otpauth,
      {
        type: "svg",
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#0F1115", light: "#FFFFFF" },
      },
      (error, svg) => {
        if (error || !svg || !svg.includes("<svg") || /<script/i.test(svg)) {
          reject(error ?? new Error("QR"));
          return;
        }
        resolve(svg);
      }
    );
  });
}
