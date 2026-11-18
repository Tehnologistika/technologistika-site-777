# Общие операции с каталогом /var/backups/technologistika.
# Код (dist) и копии базы лежат раздельно. Этот файл подключают, а не запускают.

DATA_RETENTION_DAYS=30

stamp_epoch() {
  local s="$1" iso
  [[ "$s" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || return 1
  iso="$(printf '%s-%s-%sT%s:%s:%sZ' "${s:0:4}" "${s:4:2}" "${s:6:2}" "${s:9:2}" "${s:11:2}" "${s:13:2}")"
  date -u -d "$iso" +%s
}

# Удаляет только копии leads.sqlite старше DATA_RETENTION_DAYS.
# Каталоги code/ и dist не трогает.
prune_data_copies() {
  local root="$1"
  local days="${2:-30}"
  local now="${3:-$(date -u +%s)}"
  local limit=$((days * 86400))
  local dir stamp epoch age

  if [[ -z "$root" || "$root" == "/" ]]; then
    echo "Отказ: небезопасный каталог копий." >&2
    return 1
  fi

  if [[ -d "$root/data" ]]; then
    for dir in "$root/data"/*; do
      [[ -d "$dir" ]] || continue
      stamp="$(basename "$dir")"
      epoch="$(stamp_epoch "$stamp")" || continue
      age=$((now - epoch))
      if ((age >= limit)); then
        rm -rf -- "$dir"
        echo "Удалена копия базы: $dir"
      fi
    done
  fi

  # Старая раскладка: <корень>/<снимок>/data рядом с dist.
  for dir in "$root"/*; do
    [[ -d "$dir" ]] || continue
    stamp="$(basename "$dir")"
    [[ "$stamp" == "code" || "$stamp" == "data" ]] && continue
    [[ -d "$dir/data" ]] || continue
    epoch="$(stamp_epoch "$stamp")" || continue
    age=$((now - epoch))
    if ((age >= limit)); then
      rm -rf -- "$dir/data"
      echo "Удалена копия базы: $dir/data"
    fi
  done
}
