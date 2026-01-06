#!/usr/bin/env bash
set -euo pipefail

# Profile Switchboard using Node.js CPU profiling
# Usage: ./scripts/profile-switchboard.sh [switchboard-options...]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PERF_DIR="${SCRIPT_DIR}/.perf"
LOG_DIR="${SCRIPT_DIR}/.perf/logs"
mkdir -p "$PERF_DIR"
mkdir -p "$LOG_DIR"

# Generate timestamp-based names
ts="$(date +%Y%m%d-%H%M%S)"
profile_name="switchboard-${ts}.cpuprofile"
log_file="${LOG_DIR}/switchboard-${ts}.log"

# Set up CPU profiling
export NODE_OPTIONS="--cpu-prof --cpu-prof-dir=${PERF_DIR} --cpu-prof-name=${profile_name}"

echo "=========================================="
echo "Switchboard CPU Profiling"
echo "=========================================="
echo "Profile: ${PERF_DIR}/${profile_name}"
echo "Log: ${log_file}"
echo "NODE_OPTIONS: $NODE_OPTIONS"
echo "Press Ctrl+C to stop"
echo "=========================================="
echo

# Cleanup function to ensure profile is written
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
    echo "Sending SIGUSR1 to trigger profile write..."
    kill -USR1 "$pid" 2>/dev/null || true
    sleep 2
  fi
  
  # Check for profile in alternative locations
  if [ ! -f "${PERF_DIR}/${profile_name}" ] && [ -f "${HOME}/.ph/${profile_name}" ]; then
    echo "Copying profile from ~/.ph..."
    cp "${HOME}/.ph/${profile_name}" "${PERF_DIR}/${profile_name}"
  fi
  
  echo "Cleanup complete"
}

# Set up signal handlers
trap cleanup INT TERM

# Run switchboard with logging
echo "Starting Switchboard..."
echo "Logging to: ${log_file}"
echo

# Run switchboard, capturing both stdout and stderr to log file
# Also display output in real-time
{
  ph switchboard "$@" 2>&1 | tee -a "$log_file"
} &
switchboard_pid=$!

# Wait for switchboard process
wait $switchboard_pid 2>/dev/null || true
exit_code=$?

# Final cleanup
cleanup

# Wait a bit more for profile to be written
sleep 2

echo
echo "=========================================="
echo "Profiling Complete"
echo "=========================================="

# Check if profile was generated
if [ -f "${PERF_DIR}/${profile_name}" ]; then
  profile_size=$(du -h "${PERF_DIR}/${profile_name}" | cut -f1)
  echo "✓ CPU Profile: ${PERF_DIR}/${profile_name} (${profile_size})"
  echo "  Open in: https://www.speedscope.app"
else
  echo "⚠ Profile not found: ${PERF_DIR}/${profile_name}"
  echo "  Checking for any recent profiles..."
  ls -lt "${PERF_DIR}/"*.cpuprofile 2>/dev/null | head -3 || echo "    No profiles found"
fi

echo "✓ Log file: ${log_file}"
echo "  Log size: $(du -h "$log_file" 2>/dev/null | cut -f1 || echo 'N/A')"

# Exit with switchboard's exit code (or 0 if profile was generated)
if [ -f "${PERF_DIR}/${profile_name}" ]; then
  exit 0
else
  exit ${exit_code:-1}
fi
