# Scripts Directory

This directory contains utility scripts for performance profiling, document management, and testing operations in the Powerhouse system.

## Table of Contents

- [Performance Profiling Scripts](#performance-profiling-scripts)
- [Document Management Scripts](#document-management-scripts)
- [Quick Reference](#quick-reference)

---

## Performance Profiling Scripts

### `analyze-cpu-profile.js`

Analyzes CPU profile files (`.cpuprofile`) to identify call stacks and bottlenecks for specific functions.

**Purpose:**
- Find who calls a target function (caller analysis)
- Find what a target function calls (callee/children analysis)
- Identify performance bottlenecks in specific code paths
- Aggregate and rank call stacks by frequency

**Usage:**
```bash
# Analyze a specific function
node scripts/analyze-cpu-profile.js .perf/switchboard-20251222-123012.cpuprofile \
  --function get --file filesystem.js --top 20

# List top functions in a profile
node scripts/analyze-cpu-profile.js .perf/switchboard-20251222-123012.cpuprofile

# Options:
#   --function <name>    Function name to analyze
#   --file <path>        Filter by file path (partial match)
#   --top <n>            Number of top call stacks to show (default: 20)
```

**Output:**
- Call stacks showing who calls the target function
- Functions called by the target (where time is spent)
- Sample counts, percentages, and timing statistics

---

### `profile-switchboard.sh`

Profiles `ph switchboard` using Node.js CPU profiling (`--cpu-prof`).

**Purpose:**
- Generate `.cpuprofile` files for `ph switchboard`
- Files are viewable in SpeedScope or Chrome DevTools
- Uses `NODE_OPTIONS` to enable profiling

**Usage:**
```bash
./scripts/profile-switchboard.sh [switchboard-options...]
```

**Output:**
- Profile file: `.perf/switchboard-YYYYMMDD-HHMMSS.cpuprofile`
- Log file: `.perf/logs/switchboard-YYYYMMDD-HHMMSS.log`

**Note:** Press Ctrl+C to stop profiling. The profile file is generated automatically.

---

### `profile-switchboard-v8.sh`

Alternative profiler using Node.js V8 profiler (`--prof`).

**Purpose:**
- Generate `isolate-*.log` files for detailed V8 profiling
- More detailed than CPU profiles but requires post-processing
- Attempts workarounds since `--prof` can't be used in `NODE_OPTIONS`

**Usage:**
```bash
./scripts/profile-switchboard-v8.sh [switchboard-options...]
```

**Output:**
- Profile file: `.perf/switchboard-YYYYMMDD-HHMMSS-isolate.log` (requires `node --prof-process` to read)
- Log file: `.perf/logs/switchboard-YYYYMMDD-HHMMSS.log`

**Note:** 
- This script may have limitations. Consider using `profile-ph-switchboard.sh` instead.
- If run interactively, the script will prompt to automatically process the profile file.

---

### `profile-ph-switchboard.sh`

Profiles `ph switchboard` by running `ph-cli` directly with `--prof`.

**Purpose:**
- Bypasses the `ph` shell wrapper to enable `--prof` flag
- Finds the actual JavaScript entry point (`ph-cli/dist/src/cli.js`)
- Handles profile file location and cleanup

**Usage:**
```bash
./scripts/profile-ph-switchboard.sh [switchboard-options...]
```

**Output:**
- Profile file: `.perf/ph-switchboard-YYYYMMDD-HHMMSS-isolate.log`
- Automatically finds and moves the `isolate-*.log` file to `.perf/`
- You must manually process it: `node --prof-process .perf/ph-switchboard-YYYYMMDD-HHMMSS-isolate.log`

**Why this exists:** The `ph` command is a shell wrapper, and `--prof` cannot be set via `NODE_OPTIONS`. This script runs the underlying `ph-cli` directly.

---

### `profile-ts-script.sh`

Profiles any TypeScript script in the `./scripts` directory.

**Purpose:**
- Profile TypeScript scripts using `node --prof` with `tsx`
- Automatically finds and moves profile files to `.perf/`
- Useful for profiling document creation, verification, and other operations

**Usage:**
```bash
# Profile a script
./scripts/profile-ts-script.sh create-documents-with-ops.ts 10 5

# Profile with arguments
./scripts/profile-ts-script.sh verify-operations.ts --driveId powerhouse --verbose
```

**Output:**
- Profile file: `.perf/<script-name>-YYYYMMDD-HHMMSS-isolate.log`
- Process with: `node --prof-process <profile-file>`

---

## Document Management Scripts

### `create-documents-with-ops.ts`

Creates N documents and adds n operations to each document.

**Purpose:**
- Generate test data for performance testing
- Load testing and benchmarking
- Create documents with operations in bulk

**Usage:**
```bash
# Create 10 documents with 5 operations each
tsx scripts/create-documents-with-ops.ts 10 5

# Specify drive and endpoint
tsx scripts/create-documents-with-ops.ts 100 20 \
  --driveId powerhouse \
  --endpoint http://localhost:4001/graphql
```

**Features:**
- Retry logic with exponential backoff for network errors
- Rate limiting (10ms delay between operations)
- Progress reporting
- Error handling for `ECONNRESET` and other transient failures

**Options:**
- `--driveId <id>`: Drive ID (optional, no default - documents created without drive if omitted)
- `--endpoint <url>`: GraphQL endpoint (default: "http://localhost:4001/graphql")

---

### `list-documents.ts`

Lists and counts documents in a drive.

**Purpose:**
- View all documents in a drive
- Count documents by type
- Get document IDs and names

**Usage:**
```bash
# List all documents
tsx scripts/list-documents.ts --driveId powerhouse

# Custom endpoint
tsx scripts/list-documents.ts \
  --endpoint http://localhost:4001/graphql \
  --driveId powerhouse
```

**Options:**
- `--driveId <id>`: Drive ID (default: "powerhouse")
- `--endpoint <url>`: GraphQL endpoint (default: "http://localhost:4001/graphql")

**Note:** The script lists all documents in the drive. There is no `--limit` option (despite what the usage comment says).

---

### `verify-operations.ts`

Verifies that operations were successfully applied to documents.

**Purpose:**
- Check if operations were applied (via revision count)
- Identify documents with errors
- Show detailed statistics and document table
- Optimized with batch queries for efficiency

**Usage:**
```bash
# Basic verification
tsx scripts/verify-operations.ts --driveId powerhouse

# With expected operation count
tsx scripts/verify-operations.ts \
  --driveId powerhouse \
  --expectedOps 10

# Verbose mode with detailed info
tsx scripts/verify-operations.ts \
  --driveId powerhouse \
  --verbose

# Custom batch size for parallel fetching
tsx scripts/verify-operations.ts \
  --driveId powerhouse \
  --batchSize 50
```

**Options:**
- `--driveId <id>`: Drive ID (default: "powerhouse")
- `--expectedOps <n>`: Expected number of operations per document
- `--verbose, -v`: Show detailed information for each document
- `--batchSize <n>`: Number of documents to fetch in parallel (default: 20)

**Output:**
- Summary statistics (total documents, revisions, operations, errors)
- Table of all documents with revision numbers
- Documents with mismatches or errors
- Key insight: Revision count is the primary indicator of applied operations

**Note:** The operations query may return 0 due to endpoint limitations, but revision count is the reliable indicator that operations changed the document state.

---

### `delete-docs-simple.ts`

Deletes documents using the MCP HTTP API.

**Purpose:**
- Bulk delete documents from a drive
- Clean up test data
- Handle Server-Sent Events (SSE) responses from the API

**Usage:**
```bash
# Delete all documents (requires confirmation)
tsx scripts/delete-docs-simple.ts --driveId powerhouse

# Skip confirmation prompt
tsx scripts/delete-docs-simple.ts --driveId powerhouse --confirm
```

**Options:**
- `--driveId <id>`: Drive ID (default: "powerhouse")
- `--confirm`: Skip confirmation prompt

**Safety:** Requires explicit confirmation unless `--confirm` flag is used.

---

### `add-npm-scripts.ts`

Adds performance testing npm scripts to `package.json`.

**Purpose:**
- Automatically add npm scripts for all utility scripts
- Ensure consistency across projects
- Update existing scripts if they've changed
- Idempotent (safe to run multiple times)

**Usage:**
```bash
tsx scripts/add-npm-scripts.ts
```

**What it adds:**
- `create-docs`: Create documents with operations
- `delete-docs-simple`: Delete documents using MCP
- `list-docs`: List documents in a drive
- `verify-ops`: Verify operations were applied to documents
- `profile-ts`: Profile TypeScript scripts
- `analyze-profile`: Analyze CPU profile files

**Output:**
- Summary of added/updated/skipped scripts
- Modified `package.json` with proper formatting

**Note:** This script is idempotent - it will only add missing scripts or update scripts that have changed. Existing scripts with correct commands are left unchanged.

---

## Quick Reference

### Performance Profiling Workflow

1. **Profile switchboard:**
   ```bash
   ./scripts/profile-switchboard.sh
   # Or for V8 profiling:
   ./scripts/profile-ph-switchboard.sh
   ```

2. **Analyze the profile:**
   ```bash
   node scripts/analyze-cpu-profile.js .perf/switchboard-*.cpuprofile \
     --function get --file filesystem.js
   ```

3. **Profile a TypeScript script:**
   ```bash
   ./scripts/profile-ts-script.sh verify-operations.ts --driveId powerhouse
   ```

### Document Testing Workflow

1. **Create test documents:**
   ```bash
   tsx scripts/create-documents-with-ops.ts 100 20 --driveId powerhouse
   ```

2. **Verify operations were applied:**
   ```bash
   tsx scripts/verify-operations.ts --driveId powerhouse --expectedOps 20 --verbose
   ```

3. **List documents:**
   ```bash
   tsx scripts/list-documents.ts --driveId powerhouse
   ```

4. **Clean up:**
   ```bash
   tsx scripts/delete-docs-simple.ts --driveId powerhouse --confirm
   ```

### Profile File Locations

- CPU profiles: `.perf/*.cpuprofile` (view in SpeedScope or Chrome DevTools)
- V8 profiles: `.perf/*-isolate.log` (process with `node --prof-process`)
- Processed V8 profiles: `.perf/*-processed.txt` (readable text format)
- Logs: `.perf/logs/*.log`

### Common Issues

**Profile file not found:**
- V8 profiler creates `isolate-*.log` in the current working directory
- Scripts automatically search and move files to `.perf/`
- Check `.perf/` directory for all profile files

**`--prof` not working:**
- Cannot be used in `NODE_OPTIONS`
- Use `profile-ph-switchboard.sh` or `profile-ts-script.sh` instead
- These scripts run Node.js directly with the flag

**Operations query returns 0:**
- This is normal due to endpoint limitations
- Use revision count as the reliable indicator
- Revision > 0 confirms operations were applied

---

## Dependencies

All scripts require:
- Node.js (for profiling scripts)
- `tsx` (for TypeScript scripts)
- GraphQL endpoint running at `http://localhost:4001` (for document scripts)
- `ph-cli` installed (for switchboard profiling)

---

## Notes

- All profile files are saved to `.perf/` directory
- Log files are saved to `.perf/logs/` directory
- Scripts use timestamp-based naming to avoid overwrites
- Most scripts include error handling and retry logic
- Document scripts use GraphQL aliases for efficient batch queries

