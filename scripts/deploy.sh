#!/usr/bin/env bash
# Выкладка сайта технологист.рф. Запускает человек на сервере:
#   sudo bash scripts/deploy.sh <git-ref>
# Агент и CI этот скрипт не запускают. Секреты и пароли не печатаются.
set -euo pipefail

APP_DIR=/var/www/technologistika-site
BACKUP_ROOT=/var/backups/technologistika
UNIT_DST=/etc/systemd/system/technologistika.service

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Нужны права root у оператора. Сам сайт после выкладки работает как technologistika." >&2
  exit 1
fi

REF="${1:-}"
if [[ -z "$REF" || "$REF" == --* ]]; then
  echo "Использование: sudo bash scripts/deploy.sh <git-ref>" >&2
  exit 1
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "Не найден репозиторий $APP_DIR" >&2
  exit 1
fi

if [[ -n "$(git -C "$APP_DIR" status --porcelain)" ]]; then
  echo "Рабочее дерево грязное. Выкладка остановлена." >&2
  exit 1
fi

# shellcheck source=service-permissions.sh
source "$APP_DIR/scripts/service-permissions.sh"
prepare_service_user

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$BACKUP_ROOT/$STAMP"
install -d -m 0700 "$BACKUP_ROOT"
install -d -m 0700 "$BACKUP"
git -C "$APP_DIR" rev-parse HEAD > "$BACKUP/previous-rev"
if [[ -d "$APP_DIR/dist" ]]; then
  cp -a "$APP_DIR/dist" "$BACKUP/dist"
fi
if [[ -f "$UNIT_DST" ]]; then
  cp -a "$UNIT_DST" "$BACKUP/technologistika.service"
fi
if [[ -f "$APP_DIR/data/leads.sqlite" ]]; then
  install -d -m 0700 "$BACKUP/data"
  cp -a "$APP_DIR/data/leads.sqlite" "$BACKUP/data/leads.sqlite"
  for side in -wal -shm; do
    if [[ -f "$APP_DIR/data/leads.sqlite$side" ]]; then
      cp -a "$APP_DIR/data/leads.sqlite$side" "$BACKUP/data/"
    fi
  done
  chmod 0600 "$BACKUP/data/"*
fi
printf '%s\n' "$BACKUP" > "$BACKUP_ROOT/latest"
chmod 0644 "$BACKUP_ROOT/latest"
echo "Снимок для отката: $BACKUP"

git -C "$APP_DIR" fetch origin
git -C "$APP_DIR" checkout --detach "$REF"

cd "$APP_DIR"
NODE_ENV=development corepack pnpm install --frozen-lockfile
NODE_ENV=development corepack pnpm build

lock_down_tree "$APP_DIR"
if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "Нет $APP_DIR/.env — создайте его до запуска сервиса. Пароль владельца в него не кладётся." >&2
  exit 1
fi
chown root:technologistika "$APP_DIR/.env"
chmod 0640 "$APP_DIR/.env"

install -m 0644 -o root -g root "$APP_DIR/deploy/technologistika.service" "$UNIT_DST"
systemctl daemon-reload
systemctl enable technologistika
systemctl restart technologistika
systemctl --no-pager --full status technologistika
echo "Готово. Ревизия: $(git -C "$APP_DIR" rev-parse --short HEAD). Порт сервиса берётся из .env (3000)."
echo "Если владелец ещё не создан, из $APP_DIR:"
echo "  sudo -u technologistika node --experimental-sqlite dist/admin-cli.js create-owner <login>"
