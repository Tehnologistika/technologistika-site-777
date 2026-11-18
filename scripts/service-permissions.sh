#!/usr/bin/env bash
# Общие права для scripts/deploy.sh и scripts/rollback.sh.
# Файл подключают, а не запускают отдельно.

prepare_service_user() {
  if ! id technologistika >/dev/null 2>&1; then
    useradd --system --user-group \
      --home-dir /var/www/technologistika-site \
      --shell /usr/sbin/nologin \
      --comment "Technologistika site" \
      technologistika
  fi
}

lock_down_tree() {
  local app="$1"
  chown -R root:technologistika "$app"
  find "$app" -type d -exec chmod 0750 {} +
  find "$app" -type f -exec chmod 0640 {} +
  install -d -o technologistika -g technologistika -m 0750 "$app/data"
  if [[ -f "$app/.env" ]]; then
    chown root:technologistika "$app/.env"
    chmod 0640 "$app/.env"
  fi
  local db="$app/data/leads.sqlite"
  if [[ -f "$db" ]]; then
    chown technologistika:technologistika "$db"
    chmod 0640 "$db"
  fi
  local side
  for side in "${db}-wal" "${db}-shm"; do
    if [[ -f "$side" ]]; then
      chown technologistika:technologistika "$side"
      chmod 0640 "$side"
    fi
  done
}
