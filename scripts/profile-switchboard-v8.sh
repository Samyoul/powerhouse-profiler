#!/usr/bin/env bash
set -euo pipefail

# Profile Switchboard using Node.js V8 profiler (--prof)
# Usage: ./scripts/profile-switchboard-v8.sh [switchboard-options...]
#
# NOTE: --prof cannot be used in NODE_OPTIONS. This script uses a workaround
# by creating a node wrapper. If this doesn't work, you may need to manually
# profile by running: node --prof $(which ph) switchboard [options...]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PERF_DIR="${SCRIPT_DIR}/.perf"
LOG_DIR="${SCRIPT_DIR}/.perf/logs"
mkdir -p "$PERF_DIR"
mkdir -p "$LOG_DIR"

# Generate timestamp-based names
ts="$(date +%Y%m%d-%H%M%S)"
profile_name="switchboard-${ts}"
log_file="${LOG_DIR}/switchboard-${ts}.log"

# Clear NODE_OPTIONS since --prof can't be used there
unset NODE_OPTIONS

echo "=========================================="
echo "Switchboard V8 Profiling"
echo "=========================================="
echo "Profile: ${PERF_DIR}/${profile_name}-isolate.log"
echo "Log: ${log_file}"
echo "Press Ctrl+C to stop"
echo "=========================================="
echo
echo "NOTE: Using workaround for --prof (cannot be in NODE_OPTIONS)"
echo "If profiling doesn't work, try running manually:"
echo "  node --prof $(which ph) switchboard $*"
echo

# Cleanup function to rename profile file
cleanup() {
  echo
  echo "=========================================="
  echo "Stopping Switchboard..."
  echo "=========================================="
  
  # Find the Node.js process running switchboard
  local pid=""
  pid=$(pgrep -f "node.*switchboard" 2>/dev/null | head -1 || true)
  
  if [ -n "$pid" ]; then
    echo "Found Node.js process: $pid"
    echo "Waiting for process to exit..."
    sleep 2
  fi
  
  # Rename the isolate file to include timestamp (if it exists in PERF_DIR)
  local latest_profile
  latest_profile=$(ls -t "${PERF_DIR}"/isolate-*.log 2>/dev/null | head -1 || true)
  if [ -n "$latest_profile" ] && [ -f "$latest_profile" ]; then
    local renamed_profile="${PERF_DIR}/${profile_name}-isolate.log"
    mv "$latest_profile" "$renamed_profile" 2>/dev/null || true
    echo "Renamed profile to: $renamed_profile"
  fi
  
  echo "Cleanup complete"
}

# Set up signal handlers
trap cleanup INT TERM

# Run switchboard with logging
echo "Starting Switchboard..."
echo "Logging to: ${log_file}"
echo

# Change to PERF_DIR so isolate-*.log files are created directly there
cd "$PERF_DIR"

# Try to run ph through node with --prof
# Since ph is a shell script wrapper, we need to find where it actually invokes node
# The workaround: try running node --prof on ph directly (may not work if ph is pure shell)
# Alternative: manually profile by running the actual node command that ph uses

# First, try the direct approach (may fail if ph doesn't exec node)
set +e
{
  # Attempt 1: Try node --prof on ph directly
  if command -v node >/dev/null 2>&1 && [ -f "$(which ph)" ]; then
    node --prof "$(which ph)" switchboard "$@" 2>&1 | tee -a "$log_file"
  else
    # Attempt 2: Just run ph normally and hope profiling works
    # (This won't work, but at least switchboard will run)
    ph switchboard "$@" 2>&1 | tee -a "$log_file"
  fi
} &
switchboard_pid=$!

# Wait for switchboard process
wait $switchboard_pid 2>/dev/null || true
exit_code=$?
set -e

# Final cleanup
cleanup

# Wait a bit more for profile to be written
sleep 2

echo
echo "=========================================="
echo "Profiling Complete"
echo "=========================================="

# Check if profile was generated (look for both isolate-*.log and renamed file)
profile_file=$(ls -t "${PERF_DIR}/${profile_name}"-isolate.log "${PERF_DIR}"/isolate-*.log 2>/dev/null | head -1 || true)

if [ -n "$profile_file" ] && [ -f "$profile_file" ]; then
  profile_size=$(du -h "$profile_file" | cut -f1)
  echo "✓ V8 Profile: $profile_file (${profile_size})"
  echo "  Process with: node --prof-process $profile_file > ${PERF_DIR}/${profile_name}-processed.txt"
  echo "  Or view in: https://www.speedscope.app (after processing)"
  
  # Optionally process the profile automatically (only if running interactively)
  if [ -t 0 ]; then
    echo
    read -p "Process profile now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      echo "Processing profile..."
      node --prof-process "$profile_file" > "${PERF_DIR}/${profile_name}-processed.txt" 2>&1
      echo "✓ Processed profile: ${PERF_DIR}/${profile_name}-processed.txt"
    fi
  else
    echo "  (Run non-interactively, skipping auto-processing)"
    echo "  Process manually with: node --prof-process $profile_file"
  fi
else
  echo "⚠ Profile not found"
  echo "  Expected: ${PERF_DIR}/${profile_name}-isolate.log or ${PERF_DIR}/isolate-*.log"
  echo "  Checking for any isolate-*.log files in ${PERF_DIR}..."
  ls -lt "${PERF_DIR}"/isolate-*.log 2>/dev/null | head -3 || echo "    No isolate-*.log files found in ${PERF_DIR}"
  echo
  echo "  NOTE: --prof cannot be used in NODE_OPTIONS."
  echo "  To manually profile, find where ph-cli invokes node and run:"
  echo "    node --prof <path-to-node-script> switchboard $*"
  echo "  Or use the CPU profiler script instead: ./scripts/profile-switchboard.sh"
fi

echo "✓ Log file: ${log_file}"
echo "  Log size: $(du -h "$log_file" 2>/dev/null | cut -f1 || echo 'N/A')"

# Exit with switchboard's exit code (or 0 if profile was generated)
if [ -n "$profile_file" ] && [ -f "$profile_file" ]; then
  exit 0
else
  exit ${exit_code:-1}
fi
