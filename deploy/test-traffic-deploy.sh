#!/usr/bin/env bash
# Self-check for traffic-deploy. Runs anywhere with GNU tools (CI, or locally in Git Bash).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
t="$(mktemp -d)"
sed -e "s|^BASE=.*|BASE=$t/opt|" -e "s|^restart() .*|restart() { echo restart >> $t/restarts; }|" \
  "$here/traffic-deploy" > "$t/run" && chmod +x "$t/run"
mkdir -p "$t/opt/releases" "$t/app/scripts" "$t/app/models" "$t/app/node_modules/onnxruntime-node"
touch "$t/app/scripts/collector.mjs" "$t/app/models/yolox_nano.onnx"

run() { SSH_ORIGINAL_COMMAND="$1" "$t/run"; }
sha() { printf '%040d' "$1"; }
pkg() { tar -czf - -C "$t/app" .; }
restarts() { [ -f "$t/restarts" ] && wc -l < "$t/restarts" || echo 0; }
fail() { echo "FAIL: $*" >&2; exit 1; }

for i in 1 2 3 4 5 6 7; do pkg | run "deploy $(sha "$i")" >/dev/null; sleep 1; done
[ "$(ls "$t/opt/releases" | wc -l)" -eq 5 ] || fail "should keep 5 releases"
[[ "$(readlink -f "$t/opt/current")" == *"-$(sha 7 | cut -c1-12)" ]] || fail "current should be newest"
[ "$(restarts)" -eq 7 ] || fail "every deploy should restart the collector"

run rollback >/dev/null
[[ "$(readlink -f "$t/opt/current")" == *"-$(sha 6 | cut -c1-12)" ]] || fail "rollback should go to previous"
[ "$(restarts)" -eq 8 ] || fail "rollback should restart the collector"

pkg | run "deploy abc" 2>/dev/null && fail "short sha accepted"
pkg | run "deploy $(sha 8); rm -rf /" 2>/dev/null && fail "command injection accepted"
run "whoami" 2>/dev/null && fail "unknown command accepted"

rm "$t/app/models/yolox_nano.onnx"
pkg | run "deploy $(sha 9)" 2>/dev/null && fail "upload without the model accepted"
touch "$t/app/models/yolox_nano.onnx"; ln -s /etc/passwd "$t/app/leak"
pkg | run "deploy $(sha 10)" 2>/dev/null && fail "symlink accepted"
[ "$(ls "$t/opt/releases" | wc -l)" -eq 5 ] || fail "rejected uploads must not leave releases behind"
[[ "$(readlink -f "$t/opt/current")" == *"-$(sha 6 | cut -c1-12)" ]] || fail "rejected upload must not change current"
[ "$(restarts)" -eq 8 ] || fail "rejected upload must not restart"

rm -rf "$t"
echo "all deploy checks passed"
