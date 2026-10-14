#!/usr/bin/env bash
# Exercice de restauration automatisé : restaure la dernière sauvegarde dans une base jetable puis vérifie
# que les garde-fous de sécurité (RLS forcée, déclencheurs d'immutabilité) sont bien revenus.
# Variables : DATABASE_URL (rôle autorisé à créer une base jetable), BACKUP_DATABASE_URL (rôle de sauvegarde, pour compter malgré la RLS),
#             BACKUP_DIR, VERIFY_STRICT=1 (exige l'égalité exacte avec le relevé ; à réserver à une base au repos).
set -euo pipefail
: "${DATABASE_URL:?}"
: "${BACKUP_DATABASE_URL:?le rôle de sauvegarde est requis pour compter sous RLS}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
latest="$(ls -1t "$BACKUP_DIR"/db-*.dump | head -1)"
admin_url="${DATABASE_URL%/*}/postgres"
scratch="ggt_verify_$$"
trap 'psql "$admin_url" -qc "drop database if exists $scratch" >/dev/null' EXIT
psql "$admin_url" -qc "create database $scratch" >/dev/null
scratch_url="${DATABASE_URL%/*}/$scratch"
"$(dirname "$0")/restore.sh" "$latest" "$scratch_url" --force > /dev/null

fail() { echo "ÉCHEC : $1" >&2; exit 1; }
q() { psql "$scratch_url" -Atc "$1"; }
# compte avec le rôle de sauvegarde (contourne la RLS) : le rôle applicatif ne verrait aucune ligne sans contexte d'entreprise
count_url="${BACKUP_DATABASE_URL%/*}/$scratch"
qc() { psql "$count_url" -Atc "select count(*) from $1"; }

for t in contact opportunity activity sales_document sales_line payment finance_entry attachment audit_log; do
  [ "$(q "select relrowsecurity and relforcerowsecurity from pg_class where relname = '$t'")" = "t" ] || fail "RLS forcée absente sur $t"
done
for trg in sales_document_guard sales_line_guard payment_guard finance_entry_guard audit_log_no_update attachment_guard; do
  [ "$(q "select count(*) from pg_trigger where tgname = '$trg'")" = "1" ] || fail "déclencheur $trg absent"
done

manifest="$BACKUP_DIR/COUNTS-$(basename "$latest" | sed -E 's/^db-(.*)\.dump$/\1/')"
echo "Sauvegarde $(basename "$latest") restaurée. Lignes (restaurées / relevé à la sauvegarde) :"
while read -r t expected; do
  got="$(qc "$t")"
  printf '  %-16s %6s / %s\n' "$t" "$got" "$expected"
  if [ "$expected" -gt 0 ] && [ "$got" -eq 0 ]; then fail "$t est vide après restauration"; fi
  if [ "${VERIFY_STRICT:-0}" = "1" ] && [ "$got" != "$expected" ]; then fail "$t : $got lignes au lieu de $expected"; fi
done < "$manifest"
echo "OK : garde-fous de sécurité (RLS forcée, déclencheurs) présents et données restaurées."
