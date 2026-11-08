#!/bin/sh
# Builds a NEARvest server release ON THE MAC, ready to copy to the VPS: the committed code only
# (git archive of HEAD: server/ and deploy/, never the git-ignored .env or data/) plus the
# production node_modules, installed with the same Node version as the VPS (24.22.0). The
# dependencies are plain JavaScript (no native parts, no install scripts), so the VPS never
# runs npm: no CPU or memory spike next to the other bots.
#
# Usage: sh deploy/stage.sh OUT_DIR NODE24_BIN_DIR
#   e.g.  sh deploy/stage.sh ~/nearvest-releases ~/node-v24.22.0/bin
# Prints the release folder (OUT_DIR/nearvest-<commit>).
set -eu
out=$1
nodebin=$2
"$nodebin/node" -v | grep -q '^v24\.' || { echo "need Node 24 in $nodebin" >&2; exit 1; }
cd "$(git rev-parse --show-toplevel)"
if ! git diff --quiet HEAD -- server deploy; then
  echo "note: uncommitted changes in server/ or deploy/ are NOT included (only the last commit)" >&2
fi
sha=$(git rev-parse --short HEAD)
dest="$out/nearvest-$sha"
if [ -e "$dest" ]; then echo "$dest already exists (already staged)" >&2; exit 1; fi
mkdir -p "$dest"
git archive HEAD server deploy | tar -x -C "$dest"
(cd "$dest/server" && PATH="$nodebin:$PATH" npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
# Safety checks: no secrets, no native modules.
test ! -e "$dest/server/.env" || { echo "a .env file got into the release" >&2; exit 1; }
if find "$dest/server/node_modules" -name '*.node' | grep -q .; then echo "native module found: cannot copy from the Mac" >&2; exit 1; fi
echo "$sha" > "$dest/RELEASE"
echo "$dest"
