import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { orcheTools, orcheHandlers } from "./tools/orche.js";
import { workerTools, workerHandlers } from "./tools/worker.js";
import { plannerTools, plannerHandlers } from "./tools/planner.js";
import { reviewerTools, reviewerHandlers } from "./tools/reviewer.js";
import type { Role } from "./types.js";

// Parse command line arguments
function parseArgs(): { role: Role; workerId?: string } {
  const args = process.argv.slice(2);
  let role: Role = "orche";
  let workerId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--role" && args[i + 1]) {
      role = args[i + 1] as Role;
      i++;
    } else if (args[i] === "--worker-id" && args[i + 1]) {
      workerId = args[i + 1];
      i++;
    }
  }

  // Also check environment variables
  if (process.env.WORKER_ID) {
    workerId = process.env.WORKER_ID;
    role = "worker";
  }

  return { role, workerId };
}

async function main() {
  const { role, workerId } = parseArgs();

  console.error(`Starting MCP server with role: ${role}`);
  if (workerId) {
    console.error(`Worker ID: ${workerId}`);
  }

  const server = new Server(
    {
      name: "aiorchestration",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Get tools based on role
  let tools;
  let handlers;
  if (role === "planner") {
    tools = plannerTools;
    handlers = plannerHandlers;
  } else if (role === "orche") {
    tools = orcheTools;
    handlers = orcheHandlers;
  } else if (role === "reviewer") {
    tools = reviewerTools;
    handlers = reviewerHandlers;
  } else {
    tools = workerTools;
    handlers = workerHandlers;
  }

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema),
      })),
    };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const handler = handlers[name as keyof typeof handlers];
    if (!handler) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Unknown tool: ${name}` }),
          },
        ],
      };
    }

    try {
      const result = await (handler as (args: unknown) => Promise<string>)(
        args || {}
      );
      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          },
        ],
      };
    }
  });

  // Connect to transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP server connected");
}

main().catch(console.error);
