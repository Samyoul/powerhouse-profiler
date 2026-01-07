#!/usr/bin/env tsx
/**
 * Simple script to delete documents using MCP HTTP API
 * Usage: tsx scripts/delete-docs-simple.ts [--driveId <id>] [--confirm]
 */

import { GraphQLClient, gql } from "graphql-request";
import { execSync } from "child_process";

const GET_VETRA_DOCUMENTS_QUERY = gql`
  query GetVetraDocuments($driveId: String!) {
    VetraPackage {
      getDocuments(driveId: $driveId) {
        id
      }
    }
  }
`;

async function getDocumentIds(driveId: string): Promise<string[]> {
  const client = new GraphQLClient("http://localhost:4001/graphql", { fetch });
  const response = await client.request<{
    VetraPackage: { getDocuments: Array<{ id: string }> };
  }>(GET_VETRA_DOCUMENTS_QUERY, { driveId });
  return response.VetraPackage.getDocuments.map((doc) => doc.id);
}

async function deleteViaMcp(documentId: string): Promise<boolean> {
  const request = {
    jsonrpc: "2.0" as const,
    id: Math.floor(Math.random() * 1000000),
    method: "tools/call",
    params: {
      name: "deleteDocument",
      arguments: {
        documentId,
      },
    },
  };

  try {
    const response = await fetch("http://localhost:4001/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    // Check content type - MCP may return SSE format
    const contentType = response.headers.get("content-type") || "";
    
    if (contentType.includes("text/event-stream")) {
      // Parse SSE format
      const text = await response.text();
      const lines = text.split("\n");
      
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6)); // Remove "data: " prefix
            if (data.error) {
              throw new Error(`MCP error: ${data.error.message}`);
            }
            // Parse the result content
            const content = data.result?.content?.[0]?.text;
            if (content) {
              try {
                const parsed = JSON.parse(content);
                return parsed.success === true;
              } catch {
                return content.toLowerCase().includes("success");
              }
            }
            return data.result?.success === true;
          } catch (e) {
            // If parsing fails, continue to next line
            continue;
          }
        }
      }
      return false;
    } else {
      // Parse as JSON
      const result = await response.json();
      
      if (result.error) {
        throw new Error(`MCP error: ${result.error.message}`);
      }

      // Parse the result - MCP returns content as text that needs to be parsed
      const content = result.result?.content?.[0]?.text;
      if (content) {
        try {
          const parsed = JSON.parse(content);
          return parsed.success === true;
        } catch {
          // If not JSON, check if it contains success
          return content.toLowerCase().includes("success");
        }
      }

      // Fallback: check if result has success field
      return result.result?.success === true;
    }
  } catch (error) {
    console.error(`Failed to delete ${documentId}:`, error);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let driveId = "powerhouse";
  let confirm = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--driveId" && args[i + 1]) {
      driveId = args[i + 1];
      i++;
    } else if (args[i] === "--confirm") {
      confirm = true;
    }
  }

  console.log(`Getting document IDs from drive: ${driveId}`);
  const documentIds = await getDocumentIds(driveId);
  console.log(`Found ${documentIds.length} documents to delete`);

  if (documentIds.length === 0) {
    console.log("No documents to delete.");
    return;
  }

  if (!confirm) {
    console.log(`\n⚠️  WARNING: This will delete ${documentIds.length} documents!`);
    console.log("Press Ctrl+C to cancel, or run with --confirm to skip this prompt.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log(`\nDeleting ${documentIds.length} documents via MCP...`);
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < documentIds.length; i++) {
    const docId = documentIds[i];
    const success = await deleteViaMcp(docId);
    if (success) {
      succeeded++;
    } else {
      failed++;
    }
    process.stdout.write(
      `\r  Deleted ${succeeded}/${documentIds.length} documents (${failed} failed)...`,
    );
  }

  console.log(); // New line after progress

  if (failed === 0) {
    console.log(`\n✓ Successfully deleted ${succeeded} documents`);
  } else {
    console.log(`\n⚠️  Deleted ${succeeded} documents, ${failed} failed`);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

