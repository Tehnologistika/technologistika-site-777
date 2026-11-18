import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  PRODUCTION_POLICY,
  applyAuditIpPepper,
  createPendingUser,
  deletedPublicIds,
  ensureAdminSchema,
  replayDeletes,
  setupLink,
  validateLogin,
} from "./adminAuth.ts";
import { openLeadsDb } from "./leads.ts";

type Io = {
  env: NodeJS.ProcessEnv;
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  cwd: string;
  envFile?: string;
};

export function loadEnvFile(file: string, env: NodeJS.ProcessEnv): void {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

function dbPathFrom(io: Io): string {
  const configured = (io.env.LEADS_DB_PATH ?? "").trim();
  return configured
    ? path.resolve(io.cwd, configured)
    : path.resolve(io.cwd, "data", "leads.sqlite");
}

function openCliDb(io: Io): DatabaseSync {
  const db = openLeadsDb(dbPathFrom(io));
  ensureAdminSchema(db);
  return db;
}

function usage(io: Io): void {
  io.stderr.write(
    "Использование:\n  node --experimental-sqlite dist/admin-cli.js create-owner <login>\n  node --experimental-sqlite dist/admin-cli.js export-deletes [--since <ISO>]\n  node --experimental-sqlite dist/admin-cli.js replay-deletes [файл]\n"
  );
  io.stderr.write(
    "create-owner печатает одноразовую ссылку и не задаёт пароль.\nreplay-deletes повторно удаляет заявки из журнала (action=delete) или из файла номеров.\n"
  );
}

export function runAdminCli(argv: string[], io: Io): number {
  const envFile = io.envFile ?? path.resolve(io.cwd, ".env");
  loadEnvFile(envFile, io.env);
  const [command, arg, extra] = argv;
  if (command === "create-owner") return createOwner(arg, extra, io);
  if (command === "export-deletes") return exportDeletes(argv.slice(1), io);
  if (command === "replay-deletes") return replay(arg, extra, io);
  usage(io);
  return 1;
}

function createOwner(
  login: string | undefined,
  extra: string | undefined,
  io: Io
): number {
  if (!login || extra) {
    usage(io);
    return 1;
  }
  if (!validateLogin(login)) {
    io.stderr.write("Логин: 3–32 символа, латиница, цифры, точка, _ или -.\n");
    return 1;
  }
  let db: DatabaseSync | null = null;
  try {
    db = openCliDb(io);
    const created = createPendingUser(
      db,
      login,
      "owner",
      new Date(),
      PRODUCTION_POLICY
    );
    if (!created.ok) {
      io.stderr.write(`${created.error}\n`);
      io.stderr.write("Пароль не изменён.\n");
      return 1;
    }
    const link = setupLink(created.code, io.env);
    io.stdout.write(
      `Создана учётная запись владельца «${validateLogin(login)}».\n`
    );
    io.stdout.write(
      "Пароль не задан: владелец придумает его сам по одноразовой ссылке.\n"
    );
    io.stdout.write(
      "Ссылка действует 24 часа. Не отправляйте её в общий чат.\n"
    );
    io.stdout.write(
      "Если вывод терминала пишется в файл, удалите этот код после передачи владельцу.\n\n"
    );
    io.stdout.write(`${link}\n\n`);
    io.stdout.write(`Код: ${created.code}\n`);
    return 0;
  } catch {
    io.stderr.write("Не удалось создать владельца.\n");
    return 1;
  } finally {
    db?.close();
  }
}

function exportDeletes(args: string[], io: Io): number {
  let since: string | null = null;
  if (args.length === 0) since = null;
  else if (args.length === 2 && args[0] === "--since" && args[1])
    since = args[1];
  else {
    usage(io);
    return 1;
  }
  let db: DatabaseSync | null = null;
  try {
    db = openCliDb(io);
    for (const id of deletedPublicIds(db, since)) io.stdout.write(`${id}\n`);
    return 0;
  } catch {
    io.stderr.write("Не удалось прочитать журнал удалений.\n");
    return 1;
  } finally {
    db?.close();
  }
}

function replay(
  file: string | undefined,
  extra: string | undefined,
  io: Io
): number {
  if (extra) {
    usage(io);
    return 1;
  }
  if ((io.env.AUDIT_IP_PEPPER ?? "").trim().length < 32) {
    io.stderr.write(
      "Задайте AUDIT_IP_PEPPER в окружении (не короче 32 символов). Без него повторное удаление не пишется в журнал.\n"
    );
    return 1;
  }
  applyAuditIpPepper(io.env);
  let db: DatabaseSync | null = null;
  try {
    const ids = file
      ? readFileSync(file, "utf8")
          .split("\n")
          .map(line => line.trim())
          .filter(line => /^T-\d+$/.test(line))
      : null;
    db = openCliDb(io);
    const source = ids ?? deletedPublicIds(db);
    const result = replayDeletes(db, source, new Date(), "operator");
    io.stdout.write(`Удалено повторно: ${result.removed.length}\n`);
    io.stdout.write(`Уже отсутствовали: ${result.absent.length}\n`);
    return 0;
  } catch {
    io.stderr.write("Не удалось повторно удалить заявки.\n");
    return 1;
  } finally {
    db?.close();
  }
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));
if (isDirect) {
  const code = runAdminCli(process.argv.slice(2), {
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
  });
  process.exit(code);
}
