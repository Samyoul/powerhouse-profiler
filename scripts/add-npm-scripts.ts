#!/usr/bin/env tsx
/**
 * Script to add performance testing npm scripts to package.json
 * Usage: tsx scripts/add-npm-scripts.ts
 *
 * This script adds the following scripts to package.json:
 * - create-docs: Create documents with operations
 * - delete-docs-simple: Delete documents using MCP
 * - list-docs: List documents in a drive
 * - verify-ops: Verify operations were applied to documents
 * - profile-ts: Profile TypeScript scripts
 * - analyze-profile: Analyze CPU profile files
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCRIPTS_TO_ADD = {
  "create-docs": "tsx scripts/create-documents-with-ops.ts",
  "delete-docs-simple": "tsx scripts/delete-docs-simple.ts",
  "list-docs": "tsx scripts/list-documents.ts",
  "verify-ops": "tsx scripts/verify-operations.ts",
  "profile-ts": "./scripts/profile-ts-script.sh",
  "analyze-profile": "node scripts/analyze-cpu-profile.js",
};

function main() {
  const projectRoot = join(__dirname, "..");
  const packageJsonPath = join(projectRoot, "package.json");

  console.log("Reading package.json...");
  const packageJsonContent = readFileSync(packageJsonPath, "utf-8");
  const packageJson = JSON.parse(packageJsonContent);

  // Ensure scripts section exists
  if (!packageJson.scripts) {
    packageJson.scripts = {};
  }

  // Track which scripts were added/updated
  const added: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  // Add or update scripts
  for (const [scriptName, scriptCommand] of Object.entries(SCRIPTS_TO_ADD)) {
    if (!(scriptName in packageJson.scripts)) {
      packageJson.scripts[scriptName] = scriptCommand;
      added.push(scriptName);
    } else if (packageJson.scripts[scriptName] !== scriptCommand) {
      const oldCommand = packageJson.scripts[scriptName];
      packageJson.scripts[scriptName] = scriptCommand;
      updated.push(scriptName);
      console.log(`  ⚠️  Updated "${scriptName}": "${oldCommand}" -> "${scriptCommand}"`);
    } else {
      skipped.push(scriptName);
    }
  }

  // Write back to package.json with proper formatting (2-space indent)
  console.log("\nWriting package.json...");
  writeFileSync(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2) + "\n",
    "utf-8",
  );

  // Print summary
  console.log("\n✅ Summary:");
  if (added.length > 0) {
    console.log(`  Added ${added.length} script(s): ${added.join(", ")}`);
  }
  if (updated.length > 0) {
    console.log(`  Updated ${updated.length} script(s): ${updated.join(", ")}`);
  }
  if (skipped.length > 0) {
    console.log(
      `  Skipped ${skipped.length} script(s) (already exist): ${skipped.join(", ")}`,
    );
  }

  if (added.length === 0 && updated.length === 0) {
    console.log("\n💡 All scripts are already present and up-to-date.");
  } else {
    console.log("\n💡 Run 'npm run <script-name>' to use the scripts.");
  }
}

try {
  main();
} catch (error) {
  console.error("Error:", error);
  process.exit(1);
}

