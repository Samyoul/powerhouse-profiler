#!/usr/bin/env bash
set -euo pipefail

# Profile a TypeScript script using Node.js V8 profiler (--prof)
# Usage: ./scripts/profile-ts-script.sh <script-name> [script-args...]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PERF_DIR="${SCRIPT_DIR}/.perf"
mkdir -p "$PERF_DIR"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <script-name> [script-args...]"
  exit 1
fi

SCRIPT_NAME="$1"
shift
SCRIPT_PATH="${SCRIPT_DIR}/scripts/${SCRIPT_NAME}"

if [ ! -f "$SCRIPT_PATH" ]; then
  echo "Error: Script not found: ${SCRIPT_PATH}"
  exit 1
fi

ts="$(date +%Y%m%d-%H%M%S)"
profile_name="${SCRIPT_NAME%.ts}-${ts}"

unset NODE_OPTIONS

echo "Profiling ${SCRIPT_NAME}..."
echo "Profile will be saved to: ${PERF_DIR}/"

# Run with profiling
node --prof "$(which tsx)" "$SCRIPT_PATH" "$@"
exit_code=$?

# Find and rename the most recent isolate file
sleep 1
latest_profile=$(ls -t isolate-*.log 2>/dev/null | head -1 || true)

if [ -n "$latest_profile" ] && [ -f "$latest_profile" ]; then
  mv "$latest_profile" "${PERF_DIR}/${profile_name}-isolate.log"
  echo "✓ Profile: ${PERF_DIR}/${profile_name}-isolate.log"
  echo "  Process with: node --prof-process ${PERF_DIR}/${profile_name}-isolate.log"
else
  echo "⚠ Profile not found in current directory"
fi

exit $exit_code
