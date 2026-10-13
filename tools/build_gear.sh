#!/usr/bin/env bash
# Rebuild the gear, weapon, extras and enemy GLBs (Blender + meshopt).
# Usage: tools/build_gear.sh /path/to/jumper [only=human,orc,...]
set -euo pipefail
JUMPER=${1:?usage: tools/build_gear.sh /path/to/jumper [only]}
ONLY=${2:-}
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
"$BLENDER" -b --python "$ROOT/tools/build_gear.py" -- --jumper "$JUMPER" --out "$TMP" --only "$ONLY" | grep -E "^GEAR|Error" || true
(cd "$TMP" && find . -name "*.glb") | while read -r f; do
  mkdir -p "$ROOT/public/models/$(dirname "$f")"
  npx -y @gltf-transform/cli@4 meshopt "$TMP/$f" "$ROOT/public/models/$f" 2>&1 | grep -E "→|rror" || true
done
