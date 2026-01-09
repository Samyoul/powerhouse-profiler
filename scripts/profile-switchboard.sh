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

# Check if switchboard is installed
SWITCHBOARD_PATH="${SCRIPT_DIR}/node_modules/@powerhousedao/switchboard/dist/src/index.js"
if [ ! -f "$SWITCHBOARD_PATH" ]; then
  echo "Error: Switchboard not found at ${SWITCHBOARD_PATH}"
  echo "Please install @powerhousedao/switchboard first"
  exit 1
fi

# Cleanup function to ensure profile is written
cleanup() {
  echo
  echo "=========================================="
  echo "Stopping Switchboard..."
  echo "=========================================="
  
  # Find the Node.js process running switchboard by PID or by pattern
  local pid=""
  if [ -n "${switchboard_pid:-}" ]; then
    # Check if the PID is still running
    if kill -0 "$switchboard_pid" 2>/dev/null; then
      pid="$switchboard_pid"
    fi
  fi
  
  # Fallback: search by process pattern
  if [ -z "$pid" ]; then
    pid=$(pgrep -f "node.*switchboard.*index.js" 2>/dev/null | head -1 || true)
  fi
  
  if [ -n "$pid" ]; then
    echo "Found Node.js process: $pid"
    echo "Sending SIGTERM for graceful shutdown..."
    # Send SIGTERM for graceful shutdown - Node.js will write profile on exit
    kill -TERM "$pid" 2>/dev/null || true
    
    # Wait for process to exit (up to 5 seconds)
    for i in {1..10}; do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 0.5
    done
    
    # If still running after graceful shutdown attempt, force kill
    if kill -0 "$pid" 2>/dev/null; then
      echo "Process still running, sending SIGKILL..."
      kill -KILL "$pid" 2>/dev/null || true
      sleep 1
    fi
  fi
  
  # Check for profile in alternative locations
  if [ ! -f "${PERF_DIR}/${profile_name}" ] && [ -f "${HOME}/.ph/${profile_name}" ]; then
    echo "Copying profile from ~/.ph..."
    cp "${HOME}/.ph/${profile_name}" "${PERF_DIR}/${profile_name}"
  fi
  
  # Also check current directory and script directory
  for dir in "$(pwd)" "$SCRIPT_DIR" "${HOME}/.ph"; do
    if [ -f "${dir}/${profile_name}" ] && [ ! -f "${PERF_DIR}/${profile_name}" ]; then
      echo "Found profile in ${dir}, copying..."
      cp "${dir}/${profile_name}" "${PERF_DIR}/${profile_name}"
      break
    fi
  done
  
  echo "Cleanup complete"
}

# Set up signal handlers
# On SIGINT (Ctrl+C), send SIGTERM to the switchboard process for graceful shutdown
# Node.js will automatically write the profile on normal exit
trap 'cleanup; exit 130' INT
trap cleanup TERM

# Run switchboard with logging
echo "Starting Switchboard..."
echo "Logging to: ${log_file}"
echo

# Run switchboard directly with Node.js
# Capture output to log file and display in real-time
# Start node process and capture its PID
(
  node "$SWITCHBOARD_PATH" "$@" 2>&1 | tee -a "$log_file"
) &
switchboard_job_pid=$!

# Get the actual node process PID
sleep 0.5
switchboard_pid=$(pgrep -f "node.*switchboard.*index.js" 2>/dev/null | head -1 || echo "")

if [ -n "$switchboard_pid" ]; then
  echo "Switchboard PID: $switchboard_pid"
fi

# Wait for the background job to complete
wait $switchboard_job_pid 2>/dev/null || true
exit_code=$?

# Final cleanup
cleanup

# Wait a bit more for profile to be written
sleep 3

echo
echo "=========================================="
echo "Profiling Complete"
echo "=========================================="

# Check if profile was generated
# Node.js might create the profile with a slightly different name or location
if [ -f "${PERF_DIR}/${profile_name}" ]; then
  profile_size=$(du -h "${PERF_DIR}/${profile_name}" | cut -f1)
  echo "✓ CPU Profile: ${PERF_DIR}/${profile_name} (${profile_size})"
  echo "  Open in: https://www.speedscope.app"
else
  echo "⚠ Profile not found: ${PERF_DIR}/${profile_name}"
  echo "  Checking for any recent profiles..."
  
  # Search for any .cpuprofile files in PERF_DIR
  latest_profile=$(find "${PERF_DIR}" -maxdepth 1 -name "*.cpuprofile" -type f -newer "${SCRIPT_DIR}/scripts/profile-switchboard.sh" 2>/dev/null | head -1 || true)
  
  if [ -n "$latest_profile" ] && [ -f "$latest_profile" ]; then
    profile_size=$(du -h "$latest_profile" | cut -f1)
    echo "✓ Found recent CPU Profile: $latest_profile (${profile_size})"
    echo "  Open in: https://www.speedscope.app"
  else
    # Also check other locations
    for dir in "$(pwd)" "$SCRIPT_DIR" "${HOME}/.ph"; do
      if [ -d "$dir" ]; then
        found=$(find "$dir" -maxdepth 1 -name "*.cpuprofile" -type f -mmin -5 2>/dev/null | head -1 || true)
        if [ -n "$found" ] && [ -f "$found" ]; then
          echo "  Found profile in ${dir}: $found"
          echo "  Consider copying it to ${PERF_DIR}/"
          break
        fi
      fi
    done
    
    if [ -z "$latest_profile" ]; then
      ls -lt "${PERF_DIR}/"*.cpuprofile 2>/dev/null | head -3 || echo "    No profiles found"
    fi
  fi
fi

echo "✓ Log file: ${log_file}"
echo "  Log size: $(du -h "$log_file" 2>/dev/null | cut -f1 || echo 'N/A')"

# Exit with switchboard's exit code (or 0 if profile was generated)
if [ -f "${PERF_DIR}/${profile_name}" ]; then
  exit 0
else
  exit ${exit_code:-1}
fi
