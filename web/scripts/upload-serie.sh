#!/usr/bin/env bash
# Sube los MP4/JPG de la temporada 1 a R2 vía la API de producción:
#   POST /api/admin/serie/upload-url (Bearer CRON_SECRET) → PUT firmado directo a R2 → PATCH confirmación.
# Uso (desde web/):  bash scripts/upload-serie.sh [BASE_URL] [DIR]
set -euo pipefail
BASE="${1:-https://b2c.aprender-aleman.de}"
DIR="${2:-/c/Users/gelfi/Desktop/serie_temporada1}"
SECRET="$(grep -E '^CRON_SECRET=' .env.local | head -1 | cut -d= -f2- | tr -d '"'"'"'\r')"
[ -n "$SECRET" ] || { echo "CRON_SECRET no encontrado en .env.local"; exit 1; }
for mp4 in "$DIR"/*.mp4; do
  slug="$(basename "$mp4" .mp4)"
  for kind in video poster; do
    if [ "$kind" = video ]; then file="$mp4"; ct="video/mp4"; field=video_url; else file="$DIR/$slug.jpg"; ct="image/jpeg"; field=poster_url; fi
    [ -f "$file" ] || { echo "  $slug: falta $file"; continue; }
    resp="$(curl -sS -X POST "$BASE/api/admin/serie/upload-url" -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" -d "{\"slug\":\"$slug\",\"kind\":\"$kind\"}")"
    up="$(printf '%s' "$resp" | python -c 'import sys,json; d=json.load(sys.stdin); print(d.get("uploadUrl",""))')"
    furl="$(printf '%s' "$resp" | python -c 'import sys,json; d=json.load(sys.stdin); print(d.get("fileUrl",""))')"
    [ -n "$up" ] || { echo "  $slug/$kind: sin uploadUrl → $resp"; exit 1; }
    code="$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$up" -H "Content-Type: $ct" --data-binary "@$file")"
    [ "$code" = 200 ] || { echo "  $slug/$kind: PUT a R2 devolvió $code"; exit 1; }
    pc="$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/admin/serie/$slug" -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" -d "{\"$field\":\"$furl\"}")"
    echo "  $slug/$kind: subido ($(du -m "$file" | cut -f1) MB) · confirmado $pc"
  done
done
echo "listo"
