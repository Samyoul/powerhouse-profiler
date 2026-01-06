#!/usr/bin/env tsx
/**
 * Script to create N documents and add n operations to each document
 * Usage: tsx scripts/create-documents-with-ops.ts [N] [n] [--endpoint <url>] [--driveId <id>]
 *
 * @example
 *   tsx scripts/create-documents-with-ops.ts 10 5
 *   tsx scripts/create-documents-with-ops.ts 100 20 --endpoint http://localhost:4001/graphql
 */

import { GraphQLClient, gql } from "graphql-request";

interface CreateDocumentResponse {
  VetraPackage_createDocument: string;
}

interface SetPackageNameResponse {
  VetraPackage_setPackageName: number;
}

interface SetPackageDescriptionResponse {
  VetraPackage_setPackageDescription: number;
}

interface SetPackageCategoryResponse {
  VetraPackage_setPackageCategory: number;
}

interface SetPackageAuthorNameResponse {
  VetraPackage_setPackageAuthorName: number;
}

interface SetPackageAuthorWebsiteResponse {
  VetraPackage_setPackageAuthorWebsite: number;
}

interface AddPackageKeywordResponse {
  VetraPackage_addPackageKeyword: number;
}

const CREATE_DOCUMENT_MUTATION = gql`
  mutation CreateDocument($driveId: String, $name: String!) {
    VetraPackage_createDocument(driveId: $driveId, name: $name)
  }
`;

const SET_PACKAGE_NAME_MUTATION = gql`
  mutation SetPackageName($docId: PHID, $input: VetraPackage_SetPackageNameInput!) {
    VetraPackage_setPackageName(docId: $docId, input: $input)
  }
`;

const SET_PACKAGE_DESCRIPTION_MUTATION = gql`
  mutation SetPackageDescription(
    $docId: PHID
    $input: VetraPackage_SetPackageDescriptionInput!
  ) {
    VetraPackage_setPackageDescription(docId: $docId, input: $input)
  }
`;

const SET_PACKAGE_CATEGORY_MUTATION = gql`
  mutation SetPackageCategory($docId: PHID, $input: VetraPackage_SetPackageCategoryInput!) {
    VetraPackage_setPackageCategory(docId: $docId, input: $input)
  }
`;

const SET_PACKAGE_AUTHOR_NAME_MUTATION = gql`
  mutation SetPackageAuthorName(
    $docId: PHID
    $input: VetraPackage_SetPackageAuthorNameInput!
  ) {
    VetraPackage_setPackageAuthorName(docId: $docId, input: $input)
  }
`;

const SET_PACKAGE_AUTHOR_WEBSITE_MUTATION = gql`
  mutation SetPackageAuthorWebsite(
    $docId: PHID
    $input: VetraPackage_SetPackageAuthorWebsiteInput!
  ) {
    VetraPackage_setPackageAuthorWebsite(docId: $docId, input: $input)
  }
`;

const ADD_PACKAGE_KEYWORD_MUTATION = gql`
  mutation AddPackageKeyword($docId: PHID, $input: VetraPackage_AddPackageKeywordInput!) {
    VetraPackage_addPackageKeyword(docId: $docId, input: $input)
  }
`;

// Available operations to cycle through
// Note: setPackageName should always be first to ensure documents have names
const OPERATIONS = [
  {
    name: "setPackageName",
    mutation: SET_PACKAGE_NAME_MUTATION,
    getInput: (index: number) => ({
      name: `perf-doc-${index + 1}`, // Use same naming as document creation
    }),
  },
  {
    name: "setPackageDescription",
    mutation: SET_PACKAGE_DESCRIPTION_MUTATION,
    getInput: (index: number) => ({
      description: `Package Description ${index}`,
    }),
  },
  {
    name: "setPackageCategory",
    mutation: SET_PACKAGE_CATEGORY_MUTATION,
    getInput: (index: number) => ({
      category: `Category ${index % 5}`, // Cycle through 5 categories
    }),
  },
  {
    name: "setPackageAuthorName",
    mutation: SET_PACKAGE_AUTHOR_NAME_MUTATION,
    getInput: (index: number) => ({
      name: `Author ${index}`,
    }),
  },
  {
    name: "setPackageAuthorWebsite",
    mutation: SET_PACKAGE_AUTHOR_WEBSITE_MUTATION,
    getInput: (index: number) => ({
      website: `https://example.com/author${index}`,
    }),
  },
  {
    name: "addPackageKeyword",
    mutation: ADD_PACKAGE_KEYWORD_MUTATION,
    getInput: (index: number) => ({
      id: `keyword-${index}`,
      label: `Keyword ${index}`,
    }),
  },
] as const;

async function createDocument(
  client: GraphQLClient,
  driveId: string | undefined,
  name: string,
): Promise<string> {
  const response = await client.request<CreateDocumentResponse>(
    CREATE_DOCUMENT_MUTATION,
    {
      driveId,
      name,
    },
  );
  return response.VetraPackage_createDocument;
}

async function addOperation(
  client: GraphQLClient,
  docId: string,
  operation: (typeof OPERATIONS)[number],
  operationIndex: number,
  retries: number = 3,
  delayMs: number = 1000,
): Promise<void> {
  const input = operation.getInput(operationIndex);

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      switch (operation.name) {
        case "setPackageName":
          await client.request<SetPackageNameResponse>(operation.mutation, {
            docId,
            input,
          });
          break;
        case "setPackageDescription":
          await client.request<SetPackageDescriptionResponse>(operation.mutation, {
            docId,
            input,
          });
          break;
        case "setPackageCategory":
          await client.request<SetPackageCategoryResponse>(operation.mutation, {
            docId,
            input,
          });
          break;
        case "setPackageAuthorName":
          await client.request<SetPackageAuthorNameResponse>(operation.mutation, {
            docId,
            input,
          });
          break;
        case "setPackageAuthorWebsite":
          await client.request<SetPackageAuthorWebsiteResponse>(
            operation.mutation,
            {
              docId,
              input,
            },
          );
          break;
        case "addPackageKeyword":
          await client.request<AddPackageKeywordResponse>(operation.mutation, {
            docId,
            input,
          });
          break;
      }
      // Success - return immediately
      return;
    } catch (error: any) {
      const isConnectionError = 
        error?.message?.includes("ECONNRESET") ||
        error?.message?.includes("ECONNREFUSED") ||
        error?.message?.includes("ETIMEDOUT") ||
        error?.response?.errors?.[0]?.message?.includes("ECONNRESET");
      
      if (isConnectionError && attempt < retries - 1) {
        // Exponential backoff: 1s, 2s, 4s
        const backoffDelay = delayMs * Math.pow(2, attempt);
        console.warn(
          `\nConnection error on attempt ${attempt + 1}/${retries}, retrying in ${backoffDelay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        continue;
      }
      // If not a connection error or out of retries, throw
      throw error;
    }
  }
}


async function main() {
  const args = process.argv.slice(2);
  let numDocuments = 10;
  let numOperations = 5;
  let endpoint = "http://localhost:4001/graphql";
  let driveId: string | undefined;

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
Usage: tsx scripts/create-documents-with-ops.ts [N] [n] [options]

Arguments:
  N                    Number of documents to create (default: 10)
  n                    Number of operations to add per document (default: 5)

Options:
  --endpoint <url>     GraphQL endpoint (default: http://localhost:4001/graphql)
  --driveId <id>       Drive ID to add documents to (optional)
  --help, -h           Show this help message

Examples:
  tsx scripts/create-documents-with-ops.ts 10 5
  tsx scripts/create-documents-with-ops.ts 100 20 --endpoint http://localhost:4001/graphql
  tsx scripts/create-documents-with-ops.ts 50 10 --driveId my-drive-id
`);
      process.exit(0);
    } else if (!isNaN(Number(arg))) {
      if (numDocuments === 10) {
        numDocuments = Number(arg);
      } else if (numOperations === 5) {
        numOperations = Number(arg);
      }
    }
  }

  console.log(`Creating ${numDocuments} documents with ${numOperations} operations each...`);
  console.log(`Endpoint: ${endpoint}`);
  if (driveId) {
    console.log(`Drive ID: ${driveId}`);
  }
  console.log();

  const client = new GraphQLClient(endpoint, {
    fetch,
  });

  const startTime = Date.now();
  const documentIds: string[] = [];

  // Create all documents first
  console.log(`Creating ${numDocuments} documents...`);
  for (let i = 0; i < numDocuments; i++) {
    const name = `perf-doc-${i + 1}`;
    try {
      const docId = await createDocument(client, driveId, name);
      documentIds.push(docId);
      if ((i + 1) % 10 === 0 || i === numDocuments - 1) {
        process.stdout.write(`\r  Created ${i + 1}/${numDocuments} documents`);
      }
    } catch (error) {
      console.error(`\nFailed to create document ${i + 1}:`, error);
      throw error;
    }
  }
  console.log(`\n✓ Created ${documentIds.length} documents`);

  // Add operations to each document
  console.log(`\nAdding ${numOperations} operations to each document...`);
  let totalOperations = 0;
  const operationDelay = 10; // Small delay between operations to avoid overwhelming the server
  
  for (let docIndex = 0; docIndex < documentIds.length; docIndex++) {
    const docId = documentIds[docIndex];
    // Always set package name first to ensure every document has a name
    const setNameOperation = OPERATIONS[0]; // setPackageName is first
    try {
      await addOperation(client, docId, setNameOperation, docIndex);
      totalOperations++;
      await new Promise((resolve) => setTimeout(resolve, operationDelay));
    } catch (error) {
      console.error(
        `\nFailed to set package name for document ${docIndex + 1} after retries:`,
        error,
      );
      throw error;
    }
    
    // Add remaining operations (skip first one since we already did it)
    for (let opIndex = 1; opIndex < numOperations; opIndex++) {
      const operation = OPERATIONS[opIndex % OPERATIONS.length];
      const globalOpIndex = docIndex * numOperations + opIndex;
      try {
        await addOperation(client, docId, operation, globalOpIndex);
        totalOperations++;
        
        // Small delay to avoid overwhelming the server
        if (opIndex < numOperations - 1) {
          await new Promise((resolve) => setTimeout(resolve, operationDelay));
        }
        
        if (totalOperations % 50 === 0 || totalOperations === numDocuments * numOperations) {
          process.stdout.write(
            `\r  Added ${totalOperations}/${numDocuments * numOperations} operations`,
          );
        }
      } catch (error) {
        console.error(
          `\nFailed to add operation ${opIndex + 1} to document ${docIndex + 1} after retries:`,
          error,
        );
        throw error;
      }
    }
  }
  console.log(`\n✓ Added ${totalOperations} operations`);

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  console.log(`\n✓ Completed in ${duration}s`);
  console.log(`  Documents: ${documentIds.length}`);
  console.log(`  Operations: ${totalOperations}`);
  console.log(`  Operations per document: ${numOperations}`);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

