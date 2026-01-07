#!/usr/bin/env bash
set -euo pipefail

# Script to download perf-project scripts and set up npm scripts
# Usage: ./setup-scripts.sh [branch]
#
# Examples:
#   ./setup-scripts.sh           # Clone from default branch (main)
#   ./setup-scripts.sh master    # Clone from master branch

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_URL="https://github.com/Samyoul/powerhouse-profiler"
BRANCH="${1:-main}"
TEMP_DIR=""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Setup Performance Testing Scripts${NC}"
echo -e "${BLUE}========================================${NC}"
echo

# Clone the repository
echo -e "${BLUE}Cloning repository...${NC}"
TEMP_DIR="$(mktemp -d)"
trap "rm -rf '$TEMP_DIR'" EXIT

echo "Repository: $REPO_URL"
echo "Branch: $BRANCH"
echo "Temp directory: $TEMP_DIR"
echo

if ! git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TEMP_DIR" 2>/dev/null; then
  echo -e "${YELLOW}⚠${NC}  Failed to clone branch '$BRANCH', trying default branch..."
  git clone --depth 1 "$REPO_URL" "$TEMP_DIR"
fi

SCRIPT_SOURCE_DIR="$TEMP_DIR/scripts"

if [ ! -d "$SCRIPT_SOURCE_DIR" ]; then
  echo -e "${YELLOW}⚠${NC}  No 'scripts' directory found in repository"
  exit 1
fi

# Check if add-npm-scripts.ts exists
if [ ! -f "$SCRIPT_SOURCE_DIR/add-npm-scripts.ts" ]; then
  echo -e "${YELLOW}⚠${NC}  add-npm-scripts.ts not found in scripts directory"
  exit 1
fi

# Create local scripts directory if it doesn't exist
LOCAL_SCRIPTS_DIR="$(pwd)/scripts"
echo -e "${BLUE}Copying scripts to: $LOCAL_SCRIPTS_DIR${NC}"
mkdir -p "$LOCAL_SCRIPTS_DIR"

# Copy all script files
cp -r "$SCRIPT_SOURCE_DIR"/* "$LOCAL_SCRIPTS_DIR/"
echo -e "${GREEN}✓${NC} Scripts copied"

echo
echo -e "${BLUE}Running add-npm-scripts.ts...${NC}"
echo

# Check if tsx is available
if ! command -v tsx >/dev/null 2>&1; then
  echo -e "${YELLOW}⚠${NC}  'tsx' not found. Installing..."
  if command -v npm >/dev/null 2>&1; then
    npm install --save-dev tsx
  elif command -v pnpm >/dev/null 2>&1; then
    pnpm add -D tsx
  elif command -v yarn >/dev/null 2>&1; then
    yarn add -D tsx
  else
    echo -e "${YELLOW}⚠${NC}  No package manager found. Please install tsx manually:"
    echo "  npm install --save-dev tsx"
    exit 1
  fi
fi

# Run the script
tsx "$LOCAL_SCRIPTS_DIR/add-npm-scripts.ts"

echo
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo
echo "You can now use the npm scripts:"
echo "  npm run create-docs"
echo "  npm run list-docs"
echo "  npm run verify-ops"
echo "  npm run profile-ts"
echo "  npm run analyze-profile"
echo

