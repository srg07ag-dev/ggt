#!/usr/bin/env bash
# Sauvegarde : base PostgreSQL (format custom, restaurable table par table) + justificatifs, avec empreintes SHA-256.
# La RLS est FORCÉE sur les tables métier (même pour leur propriétaire) : un pg_dump avec le rôle applicatif échoue.
# Utilisez un rôle de sauvegarde dédié, en lecture seule, autorisé à contourner la RLS (voir docs/OPERATIONS.md) :
#   CREATE ROLE ggt_backup LOGIN PASSWORD '…' BYPASSRLS;  GRANT pg_read_all_data TO ggt_backup;
# Variables : BACKUP_DATABASE_URL (rôle de sauvegarde ; à défaut DATABASE_URL), BACKUP_DIR (./backups),
#             STORAGE_DIR (.storage), KEEP_DAYS (14), BACKUP_GPG_RECIPIENT (optionnel : chiffre pour cette clé GPG).
set -euo pipefail
: "${BACKUP_DATABASE_URL:=${DATABASE_URL:-}}"
: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL (ou DATABASE_URL) est requis}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STORAGE_DIR="${STORAGE_DIR:-.storage}"
KEEP_DAYS="${KEEP_DAYS:-14}"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$BACKUP_DIR"

db_file="$BACKUP_DIR/db-$ts.dump"
trap 'rm -f "$db_file"' ERR # jamais de sauvegarde partielle laissée en place
pg_dump --format=custom --no-owner --no-privileges --file "$db_file" "$BACKUP_DATABASE_URL"
trap - ERR
files=("$db_file")

# Relevé des volumes de lignes au moment de la sauvegarde : sert de témoin à l'exercice de restauration.
manifest="$BACKUP_DIR/COUNTS-$ts"
for t in company membership contact opportunity activity sales_document sales_line payment finance_entry attachment audit_log; do
  echo "$t $(psql "$BACKUP_DATABASE_URL" -Atc "select count(*) from $t")"
done > "$manifest"

if [ -d "$STORAGE_DIR" ] && [ -n "$(ls -A "$STORAGE_DIR" 2>/dev/null)" ]; then
  fs_file="$BACKUP_DIR/files-$ts.tar.gz"
  tar -czf "$fs_file" -C "$STORAGE_DIR" .
  files+=("$fs_file")
fi

(cd "$BACKUP_DIR" && sha256sum "${files[@]##*/}" "COUNTS-$ts" > "SHA256SUMS-$ts")

if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  for f in "${files[@]}"; do gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$f.gpg" "$f" && rm -f "$f"; done
fi

# Rétention : supprime les sauvegardes plus anciennes que KEEP_DAYS
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*' -o -name 'files-*' -o -name 'SHA256SUMS-*' -o -name 'COUNTS-*' \) -mtime "+$KEEP_DAYS" -delete
echo "Sauvegarde $ts terminée dans $BACKUP_DIR"
