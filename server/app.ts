import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { registerAdmin, type AdminAppOptions } from "./adminRoutes.ts";
import {
  notifyTelegram,
  parseLeadBody,
  saveLead,
  type LeadInput,
} from "./leads.ts";

export type AppOptions = AdminAppOptions & {
  env?: NodeJS.ProcessEnv;
};

export function createApp(options: AppOptions): express.Express {
  const app = express();
  const env = options.env ?? process.env;
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  app.post("/api/leads", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const db = options.db;
    if (!db)
      return res
        .status(500)
        .json({ ok: false, error: "Не удалось отправить заявку" });

    const parsed = parseLeadBody(req.body);
    if (!parsed.ok)
      return res.status(parsed.status).json({ ok: false, error: parsed.error });

    let publicId: string;
    try {
      publicId = saveLead(db, parsed.lead satisfies LeadInput);
    } catch {
      console.error("Failed to store lead");
      return res
        .status(500)
        .json({ ok: false, error: "Не удалось отправить заявку" });
    }

    const telegram = await notifyTelegram(publicId, env);
    console.info(`Lead stored ${publicId}; telegram=${telegram}`);
    return res.json({ ok: true });
  });

  registerAdmin(app, {
    db: options.db,
    env,
    policy: options.policy,
    now: options.now,
  });
  return app;
}
