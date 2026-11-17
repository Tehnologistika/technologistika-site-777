import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  PRODUCTION_POLICY,
  createPendingUser,
  ensureAdminSchema,
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

export function runAdminCli(argv: string[], io: Io): number {
  const envFile = io.envFile ?? path.resolve(io.cwd, ".env");
  loadEnvFile(envFile, io.env);
  const [command, login, extra] = argv;
  if (command !== "create-owner" || !login || extra) {
    io.stderr.write(
      "Использование: node --experimental-sqlite dist/admin-cli.js create-owner <login>\n"
    );
    io.stderr.write(
      "Команда создаёт владельца и печатает одноразовую ссылку. Пароль она не задаёт.\n"
    );
    return 1;
  }
  if (!validateLogin(login)) {
    io.stderr.write("Логин: 3–32 символа, латиница, цифры, точка, _ или -.\n");
    return 1;
  }

  const configured = (io.env.LEADS_DB_PATH ?? "").trim();
  const dbPath = configured
    ? path.resolve(io.cwd, configured)
    : path.resolve(io.cwd, "data", "leads.sqlite");
  let db: DatabaseSync | null = null;
  try {
    db = openLeadsDb(dbPath);
    ensureAdminSchema(db);
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
