#!/usr/bin/env bash
# Откат кода к снимку scripts/deploy.sh. Запускает человек на сервере:
#   sudo bash scripts/rollback.sh [снимок] [--with-db]
# Без --with-db база заявок и учётки не перезаписываются.
# --with-db возвращает заявки, удалённые после снимка: скрипт удаляет их
# повторно по журналу (action=delete), снятому до восстановления файла.
# Агент и CI этот скрипт не запускают.
set -euo pipefail

APP_DIR=/var/www/technologistika-site
BACKUP_ROOT=/var/backups/technologistika
UNIT_DST=/etc/systemd/system/technologistika.service
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=backup-layout.sh
source "$SCRIPT_DIR/backup-layout.sh"
# shellcheck source=service-permissions.sh
source "$SCRIPT_DIR/service-permissions.sh"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Нужны права root у оператора. Сервис после отката работает как technologistika." >&2
  exit 1
fi

WITH_DB=0
RAW=""
for arg in "$@"; do
  if [[ "$arg" == "--with-db" ]]; then
    WITH_DB=1
  elif [[ -z "$RAW" ]]; then
    RAW="$arg"
  else
    echo "Использование: sudo bash scripts/rollback.sh [снимок] [--with-db]" >&2
    exit 1
  fi
done

if [[ -z "$RAW" ]]; then
  if [[ ! -f "$BACKUP_ROOT/latest" ]]; then
    echo "Нет $BACKUP_ROOT/latest. Укажите снимок." >&2
    exit 1
  fi
  RAW="$(tr -d '[:space:]' < "$BACKUP_ROOT/latest")"
fi

CODE_DIR=""
DATA_DIR=""
STAMP=""
if [[ -d "$RAW" && -f "$RAW/previous-rev" && -d "$RAW/dist" ]]; then
  CODE_DIR="$RAW"
  STAMP="$(basename "$RAW")"
  if [[ -f "$RAW/data/leads.sqlite" ]]; then
    DATA_DIR="$RAW/data"
  elif [[ -f "$BACKUP_ROOT/data/$STAMP/leads.sqlite" ]]; then
    DATA_DIR="$BACKUP_ROOT/data/$STAMP"
  fi
elif [[ -d "$BACKUP_ROOT/code/$RAW" && -f "$BACKUP_ROOT/code/$RAW/previous-rev" && -d "$BACKUP_ROOT/code/$RAW/dist" ]]; then
  CODE_DIR="$BACKUP_ROOT/code/$RAW"
  STAMP="$RAW"
  if [[ -f "$BACKUP_ROOT/data/$RAW/leads.sqlite" ]]; then
    DATA_DIR="$BACKUP_ROOT/data/$RAW"
  fi
else
  echo "Снимок не найден: $RAW" >&2
  exit 1
fi

REV="$(cat "$CODE_DIR/previous-rev")"
if ! git -C "$APP_DIR" cat-file -e "${REV}^{commit}" 2>/dev/null; then
  echo "Ревизия снимка недоступна локально: $REV" >&2
  exit 1
fi

prepare_service_user

REPLAY_FILE=""
REPLAY_CLI=""
REPLAY_FAILED=0
if [[ "$WITH_DB" -eq 1 ]]; then
  echo "ВНИМАНИЕ: откат с --with-db возвращает заявки, удалённые после снимка."
  echo "После восстановления их нужно удалить повторно по журналу (action=delete)."
  if [[ -z "$DATA_DIR" || ! -f "$DATA_DIR/leads.sqlite" ]]; then
    echo "Копии базы нет: она хранится не дольше 30 дней. Откат базы остановлен, код не перезапущен." >&2
    exit 1
  fi
  if [[ -f "$APP_DIR/dist/admin-cli.js" ]]; then
    REPLAY_CLI="$CODE_DIR/admin-cli.replay.js"
    cp -a "$APP_DIR/dist/admin-cli.js" "$REPLAY_CLI"
    chmod 0700 "$REPLAY_CLI"
    REPLAY_FILE="$CODE_DIR/deletes-to-replay.txt"
    SINCE_ARGS=()
    if [[ "$STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
      SINCE="$(printf '%s-%s-%sT%s:%s:%sZ' "${STAMP:0:4}" "${STAMP:4:2}" "${STAMP:6:2}" "${STAMP:9:2}" "${STAMP:11:2}" "${STAMP:13:2}")"
      SINCE_ARGS=(--since "$SINCE")
    fi
    if (cd "$APP_DIR" && node --experimental-sqlite "$APP_DIR/dist/admin-cli.js" export-deletes "${SINCE_ARGS[@]}") >"$REPLAY_FILE"; then
      chmod 0600 "$REPLAY_FILE"
    else
      echo "Не удалось снять список удалений до восстановления базы." >&2
      REPLAY_FILE=""
    fi
  else
    echo "Нет dist/admin-cli.js. Список удалений до отката не сохранён." >&2
  fi
fi

git -C "$APP_DIR" checkout --detach "$REV"
rm -rf "$APP_DIR/dist"
cp -a "$CODE_DIR/dist" "$APP_DIR/dist"

if [[ "$WITH_DB" -eq 1 ]]; then
  systemctl stop technologistika
  install -d -o technologistika -g technologistika -m 0750 "$APP_DIR/data"
  cp -a "$DATA_DIR/leads.sqlite" "$APP_DIR/data/leads.sqlite"
  rm -f "$APP_DIR/data/leads.sqlite-wal" "$APP_DIR/data/leads.sqlite-shm"
  for side in -wal -shm; do
    if [[ -f "$DATA_DIR/leads.sqlite$side" ]]; then
      cp -a "$DATA_DIR/leads.sqlite$side" "$APP_DIR/data/"
    fi
  done
  echo "База возвращена из снимка. Заявки, удалённые после него, снова в файле, пока их не удалят повторно."
  if [[ -n "$REPLAY_FILE" && -s "$REPLAY_FILE" && -n "$REPLAY_CLI" ]]; then
    if (cd "$APP_DIR" && node --experimental-sqlite "$REPLAY_CLI" replay-deletes "$REPLAY_FILE"); then
      echo "Заявки из журнала (action=delete) удалены повторно."
    else
      echo "Повторное удаление не выполнено. Запустите:" >&2
      echo "  cd $APP_DIR && sudo -u technologistika node --experimental-sqlite $REPLAY_CLI replay-deletes $REPLAY_FILE" >&2
      REPLAY_FAILED=1
    fi
  else
    echo "Список action=delete новее снимка пуст или не сохранён."
    echo "Проверка: cd $APP_DIR && node --experimental-sqlite dist/admin-cli.js replay-deletes"
  fi
fi

if [[ -f "$CODE_DIR/technologistika.service" ]]; then
  cp -a "$CODE_DIR/technologistika.service" "$UNIT_DST"
elif [[ -f "$APP_DIR/deploy/technologistika.service" ]]; then
  install -m 0644 -o root -g root "$APP_DIR/deploy/technologistika.service" "$UNIT_DST"
fi

lock_down_tree "$APP_DIR"
systemctl daemon-reload
systemctl enable technologistika
systemctl restart technologistika
systemctl --no-pager --full status technologistika
echo "Откат кода выполнен: $(git -C "$APP_DIR" rev-parse --short HEAD). Порт остаётся 3000."
if [[ "$REPLAY_FAILED" -eq 1 ]]; then
  exit 1
fi
