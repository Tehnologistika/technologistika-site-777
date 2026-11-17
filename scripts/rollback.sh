#!/usr/bin/env bash
# Откат кода к снимку scripts/deploy.sh. Запускает человек на сервере:
#   sudo bash scripts/rollback.sh [каталог-снимка] [--with-db]
# Без --with-db база заявок и учётки не перезаписываются.
# Агент и CI этот скрипт не запускают.
set -euo pipefail

APP_DIR=/var/www/technologistika-site
BACKUP_ROOT=/var/backups/technologistika
UNIT_DST=/etc/systemd/system/technologistika.service

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Нужны права root у оператора. Сервис после отката работает как technologistika." >&2
  exit 1
fi

WITH_DB=0
BACKUP=""
for arg in "$@"; do
  if [[ "$arg" == "--with-db" ]]; then
    WITH_DB=1
  elif [[ -z "$BACKUP" ]]; then
    BACKUP="$arg"
  else
    echo "Использование: sudo bash scripts/rollback.sh [каталог-снимка] [--with-db]" >&2
    exit 1
  fi
done

if [[ -z "$BACKUP" ]]; then
  if [[ ! -f "$BACKUP_ROOT/latest" ]]; then
    echo "Нет $BACKUP_ROOT/latest. Укажите каталог снимка." >&2
    exit 1
  fi
  BACKUP="$(cat "$BACKUP_ROOT/latest")"
fi

if [[ ! -f "$BACKUP/previous-rev" || ! -d "$BACKUP/dist" ]]; then
  echo "В $BACKUP нет previous-rev или dist. Откат остановлен." >&2
  exit 1
fi

REV="$(cat "$BACKUP/previous-rev")"
if ! git -C "$APP_DIR" cat-file -e "${REV}^{commit}" 2>/dev/null; then
  echo "Ревизия снимка недоступна локально: $REV" >&2
  exit 1
fi

# shellcheck source=service-permissions.sh
source "$APP_DIR/scripts/service-permissions.sh"
prepare_service_user

git -C "$APP_DIR" checkout --detach "$REV"
rm -rf "$APP_DIR/dist"
cp -a "$BACKUP/dist" "$APP_DIR/dist"

if [[ "$WITH_DB" -eq 1 ]]; then
  if [[ ! -f "$BACKUP/data/leads.sqlite" ]]; then
    echo "В снимке нет базы. Откат базы остановлен, код не перезапущен." >&2
    exit 1
  fi
  systemctl stop technologistika
  install -d -o technologistika -g technologistika -m 0750 "$APP_DIR/data"
  cp -a "$BACKUP/data/leads.sqlite" "$APP_DIR/data/leads.sqlite"
  rm -f "$APP_DIR/data/leads.sqlite-wal" "$APP_DIR/data/leads.sqlite-shm"
  for side in -wal -shm; do
    if [[ -f "$BACKUP/data/leads.sqlite$side" ]]; then
      cp -a "$BACKUP/data/leads.sqlite$side" "$APP_DIR/data/"
    fi
  done
  echo "База возвращена из снимка. Заявки и учётки новее снимка в этом файле потеряны."
fi

if [[ -f "$BACKUP/technologistika.service" ]]; then
  cp -a "$BACKUP/technologistika.service" "$UNIT_DST"
elif [[ -f "$APP_DIR/deploy/technologistika.service" ]]; then
  install -m 0644 -o root -g root "$APP_DIR/deploy/technologistika.service" "$UNIT_DST"
fi

lock_down_tree "$APP_DIR"
systemctl daemon-reload
systemctl enable technologistika
systemctl restart technologistika
systemctl --no-pager --full status technologistika
echo "Откат кода выполнен: $(git -C "$APP_DIR" rev-parse --short HEAD). Порт остаётся 3000."
