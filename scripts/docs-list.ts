#!/usr/bin/env tsx
/**
 * Script to list and count documents
 * Usage: tsx scripts/list-documents.ts [--endpoint <url>] [--driveId <id>] [--limit <n>]
 *
 * @example
 *   tsx scripts/list-documents.ts --driveId powerhouse
 *   tsx scripts/list-documents.ts --endpoint http://localhost:4001/graphql --driveId powerhouse
 */

import { GraphQLClient, gql } from "graphql-request";

interface GetVetraDocumentsResponse {
  VetraPackage: {
    getDocuments: Array<{
      id: string;
      state: {
        name?: string;
      };
    }>;
  };
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

async function getVetraDocuments(
  client: GraphQLClient,
  driveId: string,
): Promise<Array<{ id: string; name: string }>> {
  const response = await client.request<GetVetraDocumentsResponse>(
    GET_VETRA_DOCUMENTS_QUERY,
    {
      driveId,
    },
  );

  return response.VetraPackage.getDocuments.map((doc) => ({
    id: doc.id,
    name: doc.state.name || "(unnamed)",
  }));
}

async function main() {
  const args = process.argv.slice(2);
  let endpoint = "http://localhost:4001/graphql";
  let driveId: string | null = null;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--endpoint" && args[i + 1]) {
      endpoint = args[i + 1];
      i++;
    } else if (arg === "--driveId" && args[i + 1]) {
      driveId = args[i + 1];
      i++;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: tsx scripts/list-documents.ts [options]

Options:
  --endpoint <url>     GraphQL endpoint (default: http://localhost:4001/graphql)
  --driveId <id>       Drive ID to query (default: powerhouse)
  --help, -h           Show this help message

Examples:
  tsx scripts/list-documents.ts
  tsx scripts/list-documents.ts --driveId my-drive
  tsx scripts/list-documents.ts --endpoint http://localhost:4001/graphql --driveId powerhouse
`);
      process.exit(0);
    }
  }

  // Default to "powerhouse" if not provided
  if (!driveId) {
    driveId = "powerhouse";
    console.log("Using default driveId: powerhouse");
  }

  console.log(`Listing VetraPackage documents from drive: ${driveId}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log();

  const client = new GraphQLClient(endpoint, {
    fetch,
  });

  const startTime = Date.now();

  // Get all documents
  console.log("Fetching documents...");
  const documents = await getVetraDocuments(client, driveId);
  console.log(`✓ Found ${documents.length} documents`);

  if (documents.length === 0) {
    console.log("\nNo documents found.");
    return;
  }

  // Show summary
  console.log(`\n📊 Summary:`);
  console.log(`  Total documents: ${documents.length}`);

  // Show document list
  console.log(`\n📄 Documents:`);
  documents.forEach((doc, index) => {
    console.log(`  ${index + 1}. ${doc.name} (${doc.id})`);
  });

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  console.log(`\n✓ Completed in ${duration}s`);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

