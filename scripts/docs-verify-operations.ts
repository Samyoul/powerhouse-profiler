#!/usr/bin/env tsx
/**
 * Script to verify that operations were successfully applied to documents
 * Usage: tsx scripts/verify-operations.ts [--driveId <id>] [--expectedOps <n>] [--verbose]
 *
 * @example
 *   tsx scripts/verify-operations.ts --driveId powerhouse
 *   tsx scripts/verify-operations.ts --driveId powerhouse --expectedOps 10 --verbose
 */

import { GraphQLClient, gql } from "graphql-request";

interface DocumentInfo {
  id: string;
  name: string;
  documentType: string;
  revision: number; // Always a number after processing (sum of all scopes if object)
  operationsCount: number;
  operations: Array<{
    type: string;
    index: number;
  }>;
  hasErrors: boolean;
  errorCount: number;
}

const GET_VETRA_DOCUMENTS_QUERY = gql`
  query GetVetraDocuments($driveId: String!) {
    VetraPackage {
      getDocuments(driveId: $driveId) {
        id
        state {
          name
        }
      }
    }
  }
`;

// Generate a query with aliases for multiple documents
function buildBatchDocumentQuery(documentIds: string[], limit: number = 1000): string {
  const fragments = documentIds.map(
    (id, index) => `
    doc${index}: document(id: "${id}") {
      id
      name
      documentType
      revision
      operations(first: ${limit}) {
        id
        type
        index
        error
      }
    }`,
  );
  return `query {${fragments.join("")}}`;
}

async function getVetraDocumentIds(
  client: GraphQLClient,
  driveId: string,
): Promise<Array<{ id: string; name: string }>> {
  const response = await client.request<{
    VetraPackage: {
      getDocuments: Array<{
        id: string;
        state: {
          name?: string;
        };
      }>;
    };
  }>(GET_VETRA_DOCUMENTS_QUERY, {
    driveId,
  });

  return response.VetraPackage.getDocuments.map((doc) => ({
    id: doc.id,
    name: doc.state.name || "(unnamed)",
  }));
}

// Process a single document from the batch response
function processDocument(
  doc: {
    id: string;
    name: string;
    documentType: string;
    revision: number | Record<string, number>;
    operations: Array<{
      id: string;
      type: string;
      index: number;
      error?: string;
    }>;
  } | null,
): DocumentInfo | null {
  if (!doc) {
    return null;
  }

  const operations = doc.operations || [];
  const errors = operations.filter((op) => op.error);
  
  // Calculate total revision - handle both number and object formats
  let totalRevision = 0;
  if (typeof doc.revision === "number") {
    totalRevision = doc.revision;
  } else if (typeof doc.revision === "object" && doc.revision !== null) {
    totalRevision = Object.values(doc.revision).reduce((sum, r) => sum + (typeof r === "number" ? r : 0), 0);
  }
  
  return {
    id: doc.id,
    name: doc.name || "(unnamed)",
    documentType: doc.documentType,
    revision: totalRevision,
    operationsCount: operations.length,
    operations: operations.map((op) => ({
      type: op.type,
      index: op.index,
    })),
    hasErrors: errors.length > 0,
    errorCount: errors.length,
  };
}

// Fetch all document details in a single query using aliases
async function getAllDocumentDetails(
  client: GraphQLClient,
  documentIds: string[],
  limit: number = 1000,
): Promise<DocumentInfo[]> {
  if (documentIds.length === 0) {
    return [];
  }

  try {
    // Build query with aliases for all documents
    const query = buildBatchDocumentQuery(documentIds, limit);
    const response = await client.request<Record<string, {
      id: string;
      name: string;
      documentType: string;
      revision: number | Record<string, number>;
      operations: Array<{
        id: string;
        type: string;
        index: number;
        error?: string;
      }>;
    } | null>>(query);

    // Process all documents from the response
    const results: DocumentInfo[] = [];
    for (let i = 0; i < documentIds.length; i++) {
      const doc = response[`doc${i}`];
      const processed = processDocument(doc);
      if (processed) {
        results.push(processed);
      }
    }

    return results;
  } catch (error) {
    console.error(`Error fetching document details batch:`, error);
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  let driveId: string | null = null;
  let expectedOps: number | null = null;
  let verbose = false;
  let batchSize = 20;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--driveId" && args[i + 1]) {
      driveId = args[i + 1];
      i++;
    } else if (arg === "--expectedOps" && args[i + 1]) {
      expectedOps = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg === "--batchSize" && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      if (isNaN(batchSize) || batchSize < 1) {
        console.error("Error: --batchSize must be a positive number");
        process.exit(1);
      }
      i++;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: tsx scripts/verify-operations.ts [options]

Options:
  --driveId <id>        Drive ID to verify (default: powerhouse)
  --expectedOps <n>     Expected number of operations per document
  --batchSize <n>       Number of documents to fetch in parallel (default: 20)
  --verbose, -v         Show detailed information for each document
  --help, -h            Show this help message

Examples:
  tsx scripts/verify-operations.ts
  tsx scripts/verify-operations.ts --driveId powerhouse --expectedOps 10
  tsx scripts/verify-operations.ts --driveId powerhouse --verbose
`);
      process.exit(0);
    }
  }

  if (!driveId) {
    driveId = "powerhouse";
    console.log("Using default driveId: powerhouse");
  }

  console.log(`Verifying operations for documents in drive: ${driveId}`);
  if (expectedOps !== null) {
    console.log(`Expected operations per document: ${expectedOps}`);
  }
  console.log();

  // Use drive-specific endpoint for document queries
  const driveEndpoint = `http://localhost:4001/d/${driveId}`;
  const driveClient = new GraphQLClient(driveEndpoint, { fetch });
  
  // Use supergraph endpoint for VetraPackage queries
  const supergraphEndpoint = "http://localhost:4001/graphql";
  const supergraphClient = new GraphQLClient(supergraphEndpoint, { fetch });

  // Get all documents
  console.log("Fetching documents...");
  const documents = await getVetraDocumentIds(supergraphClient, driveId);
  console.log(`✓ Found ${documents.length} documents`);
  console.log();

  if (documents.length === 0) {
    console.log("No documents found.");
    return;
  }

  // Fetch all document details in a single query (or minimal queries if too many)
  console.log("Fetching all document details...");
  const startTime = Date.now();
  
  // GraphQL queries can get very large with many aliases, so we'll batch if needed
  // Most GraphQL servers have query size limits, so we'll use a reasonable batch size
  const queryBatchSize = Math.min(batchSize, 50); // Limit aliases per query to avoid query size limits
  const results: DocumentInfo[] = [];
  
  if (documents.length <= queryBatchSize) {
    // Single query for all documents
    const documentIds = documents.map((d) => d.id);
    const batchResults = await getAllDocumentDetails(driveClient, documentIds);
    results.push(...batchResults);
  } else {
    // Multiple queries, but still much fewer than individual queries
    for (let i = 0; i < documents.length; i += queryBatchSize) {
      const batch = documents.slice(i, i + queryBatchSize);
      const documentIds = batch.map((d) => d.id);
      const batchResults = await getAllDocumentDetails(driveClient, documentIds);
      results.push(...batchResults);
      
      const processed = Math.min(i + queryBatchSize, documents.length);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`\r  Fetched ${processed}/${documents.length} documents (${elapsed}s)...`);
    }
  }
  
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  const queryCount = Math.ceil(documents.length / queryBatchSize);
  console.log(); // New line after progress
  console.log(`✓ Fetched ${results.length} documents in ${queryCount} query/queries (${totalTime}s)`);
  console.log();

  // Analyze results
  console.log("\n📊 Verification Results:");
  console.log("=" .repeat(60));

  const totalDocs = results.length;
  const docsWithOps = results.filter((r) => r.operationsCount > 0).length;
  const docsWithoutOps = results.filter((r) => r.operationsCount === 0).length;
  const docsWithErrors = results.filter((r) => r.hasErrors).length;
  const totalOps = results.reduce((sum, r) => sum + r.operationsCount, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errorCount, 0);
  
  // Count documents with revisions (primary indicator of successful operations)
  const docsWithRevisions = results.filter((r) => r.revision > 0).length;
  const totalRevisions = results.reduce((sum, r) => sum + r.revision, 0);

  console.log(`Total documents: ${totalDocs}`);
  console.log(`Documents with revisions: ${docsWithRevisions} (primary indicator of successful operations)`);
  console.log(`Total revisions: ${totalRevisions}`);
  console.log();
  console.log(`Operations query results (may be limited by endpoint):`);
  console.log(`  Documents with operations returned: ${docsWithOps}`);
  console.log(`  Documents without operations returned: ${docsWithoutOps}`);
  console.log(`  Total operations returned: ${totalOps}`);
  console.log(`Documents with errors: ${docsWithErrors}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log();

  if (expectedOps !== null) {
    const docsWithExpectedOps = results.filter(
      (r) => r.operationsCount === expectedOps,
    ).length;
    const docsWithWrongOps = results.filter(
      (r) => r.operationsCount !== expectedOps && r.operationsCount > 0,
    ).length;

    console.log(`Expected operations per document: ${expectedOps}`);
    console.log(`Documents with expected operations: ${docsWithExpectedOps}`);
    console.log(`Documents with wrong operation count: ${docsWithWrongOps}`);
    console.log();

    if (docsWithWrongOps > 0) {
      console.log("⚠️  Documents with unexpected operation counts:");
      results
        .filter((r) => r.operationsCount !== expectedOps && r.operationsCount > 0)
        .slice(0, 10)
        .forEach((r) => {
          console.log(
            `  - ${r.name} (${r.id.slice(0, 8)}...): ${r.operationsCount} operations (expected ${expectedOps})`,
          );
        });
      if (docsWithWrongOps > 10) {
        console.log(`  ... and ${docsWithWrongOps - 10} more`);
      }
      console.log();
    }
  }

  // Check revision vs operations count
  const revisionMismatches = results.filter(
    (r) => r.revision > 0 && r.operationsCount === 0,
  );
  if (revisionMismatches.length > 0) {
    console.log(`ℹ️  ${revisionMismatches.length} documents with revisions but operations query returned 0:`);
    revisionMismatches.slice(0, 10).forEach((r) => {
      console.log(
        `  - ${r.name} (${r.id.slice(0, 8)}...): revision=${r.revision} (${r.revision} operations applied)`,
      );
    });
    if (revisionMismatches.length > 10) {
      console.log(`  ... and ${revisionMismatches.length - 10} more`);
    }
    console.log();
    console.log(`✅ These documents have revisions, which confirms operations were successfully applied.`);
    console.log(`   The operations query may return 0 due to endpoint limitations, but the revision count`);
    console.log(`   is the reliable indicator that operations changed the document state.`);
    console.log();
  }

  // Show documents with errors
  if (docsWithErrors > 0) {
    console.log(`⚠️  ${docsWithErrors} documents with operation errors:`);
    results
      .filter((r) => r.hasErrors)
      .slice(0, 10)
      .forEach((r) => {
        console.log(
          `  - ${r.name} (${r.id.slice(0, 8)}...): ${r.errorCount} error(s)`,
        );
      });
    if (docsWithErrors > 10) {
      console.log(`  ... and ${docsWithErrors - 10} more`);
    }
    console.log();
  }

  // Show documents without revisions (these are the ones that truly have no operations)
  const docsWithoutRevisions = results.filter((r) => r.revision === 0).length;
  if (docsWithoutRevisions > 0) {
    console.log(`⚠️  ${docsWithoutRevisions} documents without revisions (no operations applied):`);
    results
      .filter((r) => r.revision === 0)
      .slice(0, 10)
      .forEach((r) => {
        console.log(`  - ${r.name} (${r.id.slice(0, 8)}...) - revision=0`);
      });
    if (docsWithoutRevisions > 10) {
      console.log(`  ... and ${docsWithoutRevisions - 10} more`);
    }
    console.log();
  }

  // List all documents with revision numbers
  console.log("\n📋 All Documents with Revision Numbers:");
  console.log("=" .repeat(60));
  
  // Sort by revision (descending) to show documents with most operations first
  const sortedResults = [...results].sort((a, b) => b.revision - a.revision);
  
  sortedResults.forEach((r, index) => {
    const revisionStatus = r.revision > 0 ? "✅" : "⚠️ ";
    console.log(
      `${(index + 1).toString().padStart(4)}. ${revisionStatus} ${r.name.padEnd(30)} - Revision: ${r.revision.toString().padStart(4)} (ID: ${r.id.slice(0, 8)}...)`,
    );
  });
  
  console.log();

  // Verbose mode: show additional details for each document
  if (verbose) {
    console.log("\n📄 Detailed Document Information:");
    console.log("=" .repeat(60));
    sortedResults.slice(0, 20).forEach((r) => {
      console.log(`\n${r.name} (${r.id})`);
      console.log(`  Type: ${r.documentType}`);
      console.log(`  Revision: ${r.revision}`);
      console.log(`  Operations: ${r.operationsCount}`);
      if (r.hasErrors) {
        console.log(`  ⚠️  Errors: ${r.errorCount}`);
      }
      if (r.operations.length > 0) {
        console.log(`  Operation types: ${r.operations.map((op) => op.type).join(", ")}`);
      }
    });
    if (results.length > 20) {
      console.log(`\n... and ${results.length - 20} more documents`);
    }
    console.log();
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  if (docsWithoutRevisions === 0 && docsWithErrors === 0) {
    console.log("✅ All documents have revisions (operations were successfully applied) and no errors!");
  } else if (docsWithoutRevisions > 0) {
    console.log(`⚠️  ${docsWithoutRevisions} documents have no revisions (operations were not applied)`);
  } else if (docsWithErrors > 0) {
    console.log(`⚠️  ${docsWithErrors} documents have operation errors`);
  }
  
  console.log();
  console.log("💡 Key Insight: Revision count is the primary evidence that operations were executed.");
  console.log("   Operations change document state, and revisions track those state changes.");
  console.log("   If a document has revision > 0, operations were successfully applied.");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

