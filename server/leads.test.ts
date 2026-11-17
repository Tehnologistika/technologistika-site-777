import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDN } from "../shared/pdn.ts";
import {
  listLeads,
  notifyTelegram,
  openLeadsDb,
  parseLeadBody,
  purgeExpired,
  saveLead,
  telegramEnabled,
} from "./leads.ts";

const db = openLeadsDb(path.join(mkdtempSync(path.join(tmpdir(), "leads-")), "leads.sqlite"));

const sample = {
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
};

const missingConsent = parseLeadBody({ ...sample, consent: false });
assert.equal(missingConsent.ok, false);

const parsed = parseLeadBody(sample);
assert.equal(parsed.ok, true);
if (!parsed.ok) throw new Error("expected lead");

const publicId = saveLead(db, parsed.lead, new Date("2026-11-17T12:00:00.000Z"));
assert.equal(publicId, "T-0001");

const [row] = listLeads(db);
assert.equal(row.publicId, "T-0001");
assert.equal(row.name, "Иван");
assert.equal(row.phone, "+7 916 000-00-00");
assert.equal(row.consentText, PDN.consentCheckboxText);
assert.equal(row.consentTextVersion, PDN.consentCheckboxVersion);
assert.equal(row.consentAt, "2026-11-17T12:00:00.000Z");
assert.equal(row.policyVersion, PDN.policyVersion);

assert.equal(telegramEnabled({ TELEGRAM_NOTIFY: "false" }), false);
assert.equal(telegramEnabled({}), false);

let calls = 0;
const skipped = await notifyTelegram(publicId, { TELEGRAM_NOTIFY: "false", TELEGRAM_BOT_TOKEN: "secret" }, async () => {
  calls += 1;
  throw new Error("telegram must not be called");
});
assert.equal(skipped, "skipped");
assert.equal(calls, 0);

let sentBody = "";
const sent = await notifyTelegram(
  publicId,
  { TELEGRAM_NOTIFY: "true", TELEGRAM_BOT_TOKEN: "123:ABC", TELEGRAM_LEADS_CHAT_ID: "1" },
  async (_url, init) => {
    sentBody = String(init?.body ?? "");
    return new Response("ok", { status: 200 });
  },
);
assert.equal(sent, "sent");
const payload = JSON.parse(sentBody) as { text: string };
assert.equal(payload.text, "Новая заявка №T-0001, откройте админку");
for (const secret of ["Иван", "916", "Москва", "Казань", "Camry", "Позвоните"]) {
  assert.equal(payload.text.includes(secret), false, secret);
}

const removed = purgeExpired(db, 183, new Date("2027-06-01T00:00:00.000Z"));
assert.equal(removed, 1);
assert.equal(listLeads(db).length, 0);

db.close();
console.log("leads tests ok");
