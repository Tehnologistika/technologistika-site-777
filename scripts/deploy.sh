#!/usr/bin/env bash
# Выкладка сайта технологист.рф. Запускает человек на сервере:
#   sudo bash scripts/deploy.sh <git-ref>
# Агент и CI этот скрипт не запускают. Секреты и пароли не печатаются.
set -euo pipefail

APP_DIR=/var/www/technologistika-site
BACKUP_ROOT=/var/backups/technologistika
UNIT_DST=/etc/systemd/system/technologistika.service
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=backup-layout.sh
source "$SCRIPT_DIR/backup-layout.sh"

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
CODE_DIR="$BACKUP_ROOT/code/$STAMP"
DATA_DIR="$BACKUP_ROOT/data/$STAMP"
install -d -m 0700 "$BACKUP_ROOT" "$BACKUP_ROOT/code" "$CODE_DIR"
git -C "$APP_DIR" rev-parse HEAD > "$CODE_DIR/previous-rev"
if [[ -d "$APP_DIR/dist" ]]; then
  cp -a "$APP_DIR/dist" "$CODE_DIR/dist"
fi
if [[ -f "$UNIT_DST" ]]; then
  cp -a "$UNIT_DST" "$CODE_DIR/technologistika.service"
fi
if [[ -f "$APP_DIR/data/leads.sqlite" ]]; then
  install -d -m 0700 "$BACKUP_ROOT/data" "$DATA_DIR"
  cp -a "$APP_DIR/data/leads.sqlite" "$DATA_DIR/leads.sqlite"
  for side in -wal -shm; do
    if [[ -f "$APP_DIR/data/leads.sqlite$side" ]]; then
      cp -a "$APP_DIR/data/leads.sqlite$side" "$DATA_DIR/"
    fi
  done
  chmod 0600 "$DATA_DIR"/*
fi
printf '%s\n' "$STAMP" > "$BACKUP_ROOT/latest"
chmod 0644 "$BACKUP_ROOT/latest"
echo "Снимок кода (для отката, дольше 30 дней): $CODE_DIR"
if [[ -d "$DATA_DIR" ]]; then
  echo "Снимок базы (не дольше 30 дней): $DATA_DIR"
fi

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
if [[ -f "$APP_DIR/deploy/technologistika-backup-prune.service" && -f "$APP_DIR/deploy/technologistika-backup-prune.timer" ]]; then
  install -m 0644 -o root -g root \
    "$APP_DIR/deploy/technologistika-backup-prune.service" \
    /etc/systemd/system/technologistika-backup-prune.service
  install -m 0644 -o root -g root \
    "$APP_DIR/deploy/technologistika-backup-prune.timer" \
    /etc/systemd/system/technologistika-backup-prune.timer
fi
systemctl daemon-reload
systemctl enable technologistika
if [[ -f /etc/systemd/system/technologistika-backup-prune.timer ]]; then
  systemctl enable --now technologistika-backup-prune.timer
fi
prune_data_copies "$BACKUP_ROOT" "$DATA_RETENTION_DAYS"
systemctl restart technologistika
systemctl --no-pager --full status technologistika
echo "Готово. Ревизия: $(git -C "$APP_DIR" rev-parse --short HEAD). Порт сервиса берётся из .env (3000)."
echo "Копии базы старше ${DATA_RETENTION_DAYS} дней удалены. Таймер: technologistika-backup-prune.timer."
echo "Если владелец ещё не создан, из $APP_DIR:"
echo "  sudo -u technologistika node --experimental-sqlite dist/admin-cli.js create-owner <login>"
