require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");

const db = require('../db/database');
const driveManager = require('../drive/DriveManager');

// Keep process alive
process.on('SIGINT', () => process.exit(0));

const server = new Server(
  {
    name: "command-center-knowledge",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_documents",
        description: "List all documents stored in the AI Command Center Knowledge Base",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        },
      },
      {
        name: "read_document",
        description: "Read the contents of a specific document from the Knowledge Base using its Google Drive ID",
        inputSchema: {
          type: "object",
          properties: {
            drive_id: {
              type: "string",
              description: "The Google Drive ID of the document (obtained from list_documents)",
            },
          },
          required: ["drive_id"],
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "list_documents") {
    return new Promise((resolve) => {
        db.all(`SELECT id, filename, drive_id, size FROM documents ORDER BY uploaded_at DESC`, [], (err, rows) => {
            if (err) {
                resolve({ content: [{ type: "text", text: `Error: ${err.message}` }] });
                return;
            }
            if (!rows || rows.length === 0) {
                resolve({ content: [{ type: "text", text: "No documents found in the Knowledge Base." }] });
                return;
            }
            
            let resText = "Knowledge Base Documents:\n\n";
            rows.forEach(r => {
                resText += `- File: ${r.filename} | Drive ID: ${r.drive_id} | Size: ${r.size} bytes\n`;
            });
            resolve({ content: [{ type: "text", text: resText }] });
        });
    });
  }
  
  if (request.params.name === "read_document") {
    const { drive_id } = request.params.arguments;
    if (!drive_id) {
        return { content: [{ type: "text", text: "Error: drive_id is required." }] };
    }
    
    if (!driveManager.isConnected) {
        return { content: [{ type: "text", text: "Error: AI Command Center is not connected to Google Drive." }] };
    }
    
    const result = await driveManager.downloadFile(drive_id);
    if (result.success) {
        return { content: [{ type: "text", text: result.content }] };
    } else {
        return { content: [{ type: "text", text: `Error reading from Google Drive: ${result.error}` }] };
    }
  }

  throw new Error(`Tool not found: ${request.params.name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Knowledge Base MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
