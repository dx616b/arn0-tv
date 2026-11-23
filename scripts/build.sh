#!/bin/sh
# Packages src/ into dist/Arn0Plus.wgt (unsigned; Apps2Samsung signs it on install).
#
#   npm run build         release — stub config.local.js, no secrets, no devLogUrl
#   npm run build:local   local TV sideload — your config.local.js + auto devLogUrl
#
# Local override: DEV_LOG_HOST=192.168.x.x  or  DEV_LOG_URL=http://host:8099/log
set -eu
cd "$(dirname "$0")/.."

MODE="${1:-release}"
STAGE="dist/stage"

[ -f src/icon.png ] || node scripts/make-icon.mjs
node scripts/build-marks.mjs

rm -rf "$STAGE"
mkdir -p dist
# Copy tree without marks sources / junk; stage is what gets zipped.
cp -a src "$STAGE"
rm -rf "$STAGE/img/marks"
find "$STAGE" -name '.DS_Store' -delete
find "$STAGE" -name '.*' -type f -delete 2>/dev/null || true

if [ "$MODE" = "local" ]; then
    if [ ! -f "$STAGE/js/config.local.js" ] || [ ! -s "$STAGE/js/config.local.js" ]; then
        printf '%s\n' 'window.LAUNCHER_LOCAL = {};' > "$STAGE/js/config.local.js"
    fi
    if [ -n "${DEV_LOG_URL:-}" ]; then
        URL="$DEV_LOG_URL"
    else
        HOST="$(node scripts/lan-host.mjs)"
        URL="http://${HOST}:8099/log"
    fi
    # Append so release never needs this; local builds always mirror Lab → PC.
    {
        printf '\n/* Local build only — enable Lab log mirror (npm run devlog). */\n'
        printf 'window.LAUNCHER_LOCAL = Object.assign(window.LAUNCHER_LOCAL || {}, { devLogUrl: %s });\n' \
            "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$URL")"
    } >> "$STAGE/js/config.local.js"
    echo "Local build: devLogUrl → $URL"
    echo "Run \`npm run devlog\` on Windows (same LAN as the TV) while testing."
else
    # Never ship a developer's Immich/Subsonic/devLog overrides in CI or release wgts.
    printf '%s\n' '/* No local overrides. See config.local.example.js. */' \
        > "$STAGE/js/config.local.js"
fi

# index.html always loads config.local.js — stage always has a file.
rm -f dist/Arn0Plus.wgt
(cd "$STAGE" && zip -q -r -X ../Arn0Plus.wgt . -x '*.DS_Store' -x '.*' -x 'img/marks/*')
rm -rf "$STAGE"

echo "Built dist/Arn0Plus.wgt ($MODE)"
unzip -l dist/Arn0Plus.wgt | head -40
