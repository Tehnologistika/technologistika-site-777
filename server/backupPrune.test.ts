import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const script = path.resolve("scripts/prune-data-backups.sh");

function stamp(epochMs: number): string {
  const iso = new Date(epochMs).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

test("data backups older than 30 days are removed and code snapshots stay", () => {
  const root = mkdtempSync(path.join(tmpdir(), "backup-prune-"));
  const now = Date.UTC(2026, 10, 18, 0, 0, 0);
  const nowSec = Math.floor(now / 1000);
  const day = 24 * 60 * 60 * 1000;
  const oldStamp = stamp(now - 31 * day);
  const edgeStamp = stamp(now - 30 * day);
  const freshStamp = stamp(now - 29 * day);

  const dataOld = path.join(root, "data", oldStamp);
  const dataEdge = path.join(root, "data", edgeStamp);
  const dataFresh = path.join(root, "data", freshStamp);
  const codeOld = path.join(root, "code", oldStamp, "dist");
  const legacy = path.join(root, oldStamp);
  mkdirSync(dataOld, { recursive: true });
  mkdirSync(dataEdge, { recursive: true });
  mkdirSync(dataFresh, { recursive: true });
  mkdirSync(codeOld, { recursive: true });
  mkdirSync(path.join(legacy, "data"), { recursive: true });
  mkdirSync(path.join(legacy, "dist"), { recursive: true });
  writeFileSync(path.join(dataOld, "leads.sqlite"), "old-data");
  writeFileSync(path.join(dataEdge, "leads.sqlite"), "edge-data");
  writeFileSync(path.join(dataFresh, "leads.sqlite"), "fresh-data");
  writeFileSync(path.join(codeOld, "index.js"), "code");
  writeFileSync(path.join(legacy, "data", "leads.sqlite"), "legacy-data");
  writeFileSync(path.join(legacy, "dist", "index.js"), "legacy-code");

  const run = spawnSync("bash", [script, root, "30", String(nowSec)], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);

  assert.equal(existsSync(dataOld), false);
  assert.equal(existsSync(dataEdge), false);
  assert.equal(existsSync(path.join(dataFresh, "leads.sqlite")), true);
  assert.equal(existsSync(path.join(codeOld, "index.js")), true);
  assert.equal(existsSync(path.join(legacy, "data")), false);
  assert.equal(existsSync(path.join(legacy, "dist", "index.js")), true);
  assert.match(run.stdout, /Удалена копия базы/);
  assert.equal(run.stdout.includes("code/" + oldStamp + "/dist"), false);
});
