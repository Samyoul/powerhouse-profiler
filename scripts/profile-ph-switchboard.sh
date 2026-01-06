#!/usr/bin/env bash
set -euo pipefail

# Profile ph switchboard using Node.js V8 profiler (--prof)
# This runs ph-cli directly to profile the actual switchboard process
# Usage: ./scripts/profile-ph-switchboard.sh [switchboard-options...]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PERF_DIR="${SCRIPT_DIR}/.perf"
mkdir -p "$PERF_DIR"

ts="$(date +%Y%m%d-%H%M%S)"
profile_name="ph-switchboard-${ts}"

unset NODE_OPTIONS

echo "Profiling ph switchboard (running ph-cli directly)..."
echo "Profile will be saved to: ${PERF_DIR}/"
echo

# Find ph-cli's actual JavaScript entry point (not the shell wrapper)
PH_CLI_PATH=""

# Method 1: Extract path from .bin wrapper script
BIN_WRAPPER="${SCRIPT_DIR}/node_modules/.bin/ph-cli"
if [ -f "$BIN_WRAPPER" ]; then
  # Extract the actual JS path from the wrapper script
  # The wrapper has: exec node ".../ph-cli/dist/src/cli.js"
  EXTRACTED_PATH=$(grep -oE 'ph-cli[^"]*dist/src/cli\.js' "$BIN_WRAPPER" | head -1)
  if [ -n "$EXTRACTED_PATH" ]; then
    # Get the basedir from the wrapper
    BASEDIR=$(dirname "$BIN_WRAPPER")
    PH_CLI_PATH="${BASEDIR}/${EXTRACTED_PATH}"
    # Also try without the basedir prefix (absolute path in wrapper)
    if [ ! -f "$PH_CLI_PATH" ]; then
      PH_CLI_PATH=$(grep -oE '/[^"]*ph-cli[^"]*dist/src/cli\.js' "$BIN_WRAPPER" | head -1 || true)
    fi
  fi
fi

# Method 2: Search directly in node_modules
if [ -z "$PH_CLI_PATH" ] || [ ! -f "$PH_CLI_PATH" ]; then
  PH_CLI_PATH=$(find "${SCRIPT_DIR}/node_modules" -path "*/ph-cli/dist/src/cli.js" 2>/dev/null | head -1 || true)
fi

# Method 3: Try standard location
if [ -z "$PH_CLI_PATH" ] || [ ! -f "$PH_CLI_PATH" ]; then
  if [ -f "${SCRIPT_DIR}/node_modules/@powerhousedao/ph-cli/dist/src/cli.js" ]; then
    PH_CLI_PATH="${SCRIPT_DIR}/node_modules/@powerhousedao/ph-cli/dist/src/cli.js"
  fi
fi

if [ -z "$PH_CLI_PATH" ] || [ ! -f "$PH_CLI_PATH" ]; then
  echo "Error: Could not find ph-cli"
  echo "  Make sure @powerhousedao/ph-cli is installed in your project"
  echo "  Try: pnpm add -D @powerhousedao/ph-cli"
  exit 1
fi

echo "Found ph-cli: $PH_CLI_PATH"

# Set up NODE_PATH similar to how the wrapper script does it
PH_CLI_DIR=$(dirname "$(dirname "$(dirname "$PH_CLI_PATH")")")

# Try to extract NODE_PATH from the wrapper script if it exists
BIN_WRAPPER="${SCRIPT_DIR}/node_modules/.bin/ph-cli"
if [ -f "$BIN_WRAPPER" ]; then
  # Extract NODE_PATH from wrapper (it's set in the wrapper script)
  WRAPPER_NODE_PATH=$(grep -oE 'export NODE_PATH="[^"]*"' "$BIN_WRAPPER" | head -1 | sed 's/export NODE_PATH="//;s/"$//' || true)
  if [ -n "$WRAPPER_NODE_PATH" ]; then
    export NODE_PATH="$WRAPPER_NODE_PATH"
  fi
fi

# Fallback: construct NODE_PATH if not set
if [ -z "$NODE_PATH" ]; then
  export NODE_PATH="${PH_CLI_DIR}/dist/src/node_modules:${PH_CLI_DIR}/dist/node_modules:${PH_CLI_DIR}/node_modules:${SCRIPT_DIR}/node_modules"
fi

echo "Running: node --prof $PH_CLI_PATH switchboard $*"
echo

# Run ph-cli directly with profiling
node --prof "$PH_CLI_PATH" switchboard "$@"
exit_code=$?

# Find and rename the most recent isolate file
# Node.js creates isolate files in the current working directory where it runs
sleep 2

# Search in multiple locations using find (more reliable than glob)
SEARCH_DIRS=(
  "$(pwd)"
  "$SCRIPT_DIR"
  "$HOME"
  "$HOME/.ph"
)

latest_profile=""
latest_time=0

for dir in "${SEARCH_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    # Use find to locate isolate files
    while IFS= read -r file; do
      if [ -f "$file" ]; then
        file_time=$(stat -f "%m" "$file" 2>/dev/null || stat -c "%Y" "$file" 2>/dev/null || echo "0")
        if [ "$file_time" -gt "$latest_time" ]; then
          latest_time=$file_time
          latest_profile="$file"
        fi
      fi
    done < <(find "$dir" -maxdepth 1 \( -name "isolate-*.log" -o -name "isolate-*-v8.log" \) -type f 2>/dev/null)
  fi
done

if [ -n "$latest_profile" ] && [ -f "$latest_profile" ]; then
  mv "$latest_profile" "${PERF_DIR}/${profile_name}-isolate.log"
  echo
  echo "✓ Profile: ${PERF_DIR}/${profile_name}-isolate.log"
  echo "  Process with: node --prof-process ${PERF_DIR}/${profile_name}-isolate.log"
else
  echo
  echo "⚠ Profile not found"
  echo "  Searched in: ${SEARCH_DIRS[*]}"
  echo "  Check for isolate-*.log files manually"
fi

exit $exit_code
