#!/usr/bin/env bash
# Удаляет копии базы в /var/backups/technologistika старше 30 дней.
# Код для отката (dist) не удаляет. Запускает человек, deploy.sh и systemd timer.
#   bash scripts/prune-data-backups.sh [каталог] [дни] [unix-время]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=backup-layout.sh
source "$SCRIPT_DIR/backup-layout.sh"

ROOT="${1:-/var/backups/technologistika}"
DAYS="${2:-$DATA_RETENTION_DAYS}"
NOW="${3:-$(date -u +%s)}"

if [[ ! "$DAYS" =~ ^[0-9]+$ || ! "$NOW" =~ ^[0-9]+$ ]]; then
  echo "Использование: bash scripts/prune-data-backups.sh [каталог] [дни] [unix-время]" >&2
  exit 1
fi

install -d -m 0700 "$ROOT/code" "$ROOT/data"
prune_data_copies "$ROOT" "$DAYS" "$NOW"
