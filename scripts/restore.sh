#!/usr/bin/env bash
# Restauration d'une sauvegarde dans une base CIBLE. Refuse d'écraser une base non vide sans --force.
# Usage : scripts/restore.sh <db-AAAA.dump> <url-base-cible> [--force] [--files <files-AAAA.tar.gz> <dossier-justificatifs>]
set -euo pipefail
dump="${1:?fichier .dump requis}"; target="${2:?URL de la base cible requise}"; shift 2
force=0; files=""; files_dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --force) force=1; shift ;;
    --files) files="${2:?}"; files_dir="${3:?}"; shift 3 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done
sums="$(dirname "$dump")/SHA256SUMS-$(basename "$dump" | sed -E 's/^db-(.*)\.dump$/\1/')"
if [ -f "$sums" ]; then (cd "$(dirname "$dump")" && sha256sum --check --ignore-missing "$(basename "$sums")"); else echo "Avertissement : pas de fichier d'empreintes, intégrité non vérifiée" >&2; fi

existing="$(psql "$target" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")"
if [ "$existing" -gt 0 ] && [ "$force" -ne 1 ]; then
  echo "La base cible contient déjà $existing tables. Relancez avec --force pour l'écraser." >&2; exit 1
fi
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname "$target" "$dump"
if [ -n "$files" ]; then mkdir -p "$files_dir" && tar -xzf "$files" -C "$files_dir"; fi
echo "Restauration terminée."
