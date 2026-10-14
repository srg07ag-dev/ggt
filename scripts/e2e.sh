#!/usr/bin/env bash
# Lance le serveur de production local avec e-mails écrits dans un fichier, puis les tests Playwright.
# Usage : scripts/e2e.sh [arguments playwright]   (nécessite un build : npm run build)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=3100
rm -rf .mail-outbox-e2e
# les compteurs de limitation sont en base : on les remet à zéro pour que deux exécutions rapprochées ne se gênent pas
DB_URL="${DATABASE_URL:-$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-)}"
psql "$DB_URL" -qc "truncate rate_limit, app_rate_limit" || true
export PW_CHROMIUM="${PW_CHROMIUM:-$(find /opt/pw-browsers -name chrome -type f 2>/dev/null | head -1)}"
ALLOW_INSECURE_TEST_CONFIG=true BETTER_AUTH_URL="http://localhost:$PORT" EMAIL_MODE=file \
  MAIL_OUTBOX_DIR=.mail-outbox-e2e REQUIRE_EMAIL_VERIFICATION=true \
  npx next start -p "$PORT" > /tmp/e2e-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -sf "http://localhost:$PORT/login" > /dev/null && break; sleep 0.5; done
npx playwright test "$@"
