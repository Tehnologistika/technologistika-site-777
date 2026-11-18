import express from "express";
import { createServer } from "http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAuditIpPepper,
  auditRetentionDaysFromEnv,
  ensureAdminSchema,
  purgeAudit,
} from "./adminAuth.ts";
import { createApp } from "./app.ts";
import {
  defaultDbPath,
  openLeadsDb,
  retentionDaysFromEnv,
  scheduleRetention,
} from "./leads.ts";
import type { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  let db: DatabaseSync | null = null;
  try {
    const dbPath = process.env.LEADS_DB_PATH?.trim() || defaultDbPath();
    db = openLeadsDb(dbPath);
    ensureAdminSchema(db);
    const days = retentionDaysFromEnv(process.env.LEADS_RETENTION_DAYS);
    const auditDays = auditRetentionDaysFromEnv(
      process.env.AUDIT_RETENTION_DAYS
    );
    if (!applyAuditIpPepper(process.env)) {
      console.error("AUDIT_IP_PEPPER is missing; admin IP hashes are disabled");
    }
    scheduleRetention(db, days, {
      days: auditDays,
      purge: purgeAudit,
      label: "audit row(s)",
    });
    console.info("Leads database ready");
  } catch {
    console.error("Leads database is unavailable");
    db = null;
  }

  const app = createApp({ db });
  const server = createServer(app);

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

startServer().catch(err => {
  console.error(err instanceof Error ? err.message : "Server failed to start");
  process.exit(1);
});
