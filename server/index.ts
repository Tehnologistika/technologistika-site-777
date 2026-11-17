import express from "express";
import { createServer } from "http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adminPageHtml } from "./adminPage.ts";
import {
  bearerToken,
  defaultDbPath,
  listLeads,
  notifyTelegram,
  openLeadsDb,
  parseLeadBody,
  retentionDaysFromEnv,
  saveLead,
  scheduleRetention,
  tokensMatch,
  type LeadInput,
} from "./leads.ts";
import type { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  let db: DatabaseSync | null = null;
  try {
    const dbPath = process.env.LEADS_DB_PATH?.trim() || defaultDbPath();
    db = openLeadsDb(dbPath);
    const days = retentionDaysFromEnv(process.env.LEADS_RETENTION_DAYS);
    scheduleRetention(db, days);
    console.info("Leads database ready");
  } catch {
    console.error("Leads database is unavailable");
    db = null;
  }

  // Заявки: сначала запись в БД на этом сервере, затем необязательный сигнал в Telegram без ПДн.
  app.post("/api/leads", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!db) {
      return res.status(500).json({ ok: false, error: "Не удалось отправить заявку" });
    }

    const parsed = parseLeadBody(req.body);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ ok: false, error: parsed.error });
    }

    let publicId: string;
    try {
      publicId = saveLead(db, parsed.lead satisfies LeadInput);
    } catch {
      console.error("Failed to store lead");
      return res.status(500).json({ ok: false, error: "Не удалось отправить заявку" });
    }

    const telegram = await notifyTelegram(publicId, process.env);
    console.info(`Lead stored ${publicId}; telegram=${telegram}`);
    return res.json({ ok: true });
  });

  app.get("/api/admin/leads", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
    const expected = (process.env.ADMIN_TOKEN ?? "").trim();
    if (!expected || !db) {
      return res.status(503).json({ ok: false, error: "Админка не настроена" });
    }
    const provided = bearerToken(req.header("authorization"));
    if (!provided || !tokensMatch(provided, expected)) {
      return res.status(401).json({ ok: false, error: "Неверный токен" });
    }
    try {
      return res.json(listLeads(db));
    } catch {
      console.error("Failed to list leads");
      return res.status(500).json({ ok: false, error: "Не удалось открыть список" });
    }
  });

  app.get("/admin", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.type("html").send(adminPageHtml());
  });

  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch((err) => {
  console.error(err instanceof Error ? err.message : "Server failed to start");
  process.exit(1);
});
