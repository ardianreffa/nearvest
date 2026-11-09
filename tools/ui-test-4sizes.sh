#!/bin/zsh
# Browser check (headless Chrome) at the four sizes Ardian tests: 390x844, 402x874, 430x932 and the
# laptop 1440x900. For each size: the login page (--login-only) and the garden of an EXISTING dev
# garden (--scene, PINS=1: place pins, fonts, overflow). Read-only: it creates no account.
#
# Needs a FAKE-CHAIN game server and the web dev server running on this Mac, for example:
#   cd /Users/ardianreffa/nearvest/server && CHAIN_MODE=fake PORT=8788 MASTER_KEY=<any 32-byte base64> \
#     DATABASE_PATH=/Users/ardianreffa/nearvest/server/data/fake.sqlite DEV_LOGIN=true \
#     WEB_ORIGINS=http://localhost:5174 node src/main.ts
#   cd /Users/ardianreffa/nearvest/web && VITE_API_URL=http://127.0.0.1:8788 npx vite --port 5174 --strictPort
# and a dev garden on that server (sign in with Dev login once, e.g. "shotfarm").
# Never run it against the real game key (server/.env) or the live server.
#
# Usage: /Users/ardianreffa/nearvest/tools/ui-test-4sizes.sh <devGardenUser> [outDir]
#   outDir default: /Users/ardianreffa/nearvest/screenshots/ui-test-<date-time> (git-ignored)
#   UI_URL default: http://localhost:5174

set -u
GARDEN="${1:?usage: ui-test-4sizes.sh <devGardenUser> [outDir]}"
OUT="${2:-/Users/ardianreffa/nearvest/screenshots/ui-test-$(date +%Y%m%d-%H%M%S)}"
export UI_URL="${UI_URL:-http://localhost:5174}"
TEST=/Users/ardianreffa/nearvest/tools/ui-test.mjs
mkdir -p "$OUT"
fail=0
for size in "390 844" "402 874" "430 932" "1440 900"; do
  w=${${=size}[1]}
  echo "== $size login"
  node "$TEST" "$OUT/login-$w" --login-only ${=size} 2>&1 | tee "$OUT/login-$w.log" | grep -E "FAILED|PROBLEMS|overflow"
  echo "== $size garden ($GARDEN)"
  PINS=1 node "$TEST" "$OUT/garden-$w" "--scene=$GARDEN" ${=size} 2>&1 | tee "$OUT/garden-$w.log" | grep -iE "FAILED|PROBLEMS|overflow|pins visible|fonts"
  grep -qE "FAILED|PROBLEMS: *$" "$OUT/login-$w.log" "$OUT/garden-$w.log" && fail=1
done
echo "screenshots and logs: $OUT"
exit $fail
