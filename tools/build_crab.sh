#!/usr/bin/env bash
# Rebuild public/models/crab/jumper.glb from the Jumper URDF + STLs and re-run the FK proof.
# Usage: tools/build_crab.sh /path/to/jumper [python-with-mujoco]
set -euo pipefail
JUMPER=${1:?usage: tools/build_crab.sh /path/to/jumper [python]}
PY=${2:-python3}
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
"$BLENDER" -b --python "$ROOT/tools/build_crab.py" -- --jumper "$JUMPER" --out "$TMP/jumper.raw.glb" | grep -A400 BUILD_STATS > "$TMP/stats.json" || true
mkdir -p "$ROOT/public/models/crab"
npx -y @gltf-transform/cli@4 meshopt "$TMP/jumper.raw.glb" "$ROOT/public/models/crab/jumper.glb" --quantize-normal 12
"$PY" "$ROOT/tools/check_crab_fk.py" --jumper "$JUMPER" --glb "$ROOT/public/models/crab/jumper.glb" --fixture "$ROOT/dev/fixtures/crab-fk.json"
ls -la "$ROOT/public/models/crab/jumper.glb"
