import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { orcheTools, orcheHandlers, setupSocketMessageHandler as setupOrcheSocketHandler } from "./tools/orche.js";
import { workerTools, workerHandlers, setupSocketMessageHandler } from "./tools/worker.js";
import { plannerTools, plannerHandlers, setupSocketMessageHandler as setupPlannerSocketHandler } from "./tools/planner.js";
import { reviewerTools, reviewerHandlers, setupSocketMessageHandler as setupReviewerSocketHandler } from "./tools/reviewer.js";
import type { Role } from "./types.js";
import {
  getSocketServer,
  getSocketClient,
  cleanupSocket,
} from "./lib/socket.js";

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

// Convert zod schema to JSON schema
function zodToJsonSchema(zodSchema: unknown): Record<string, unknown> {
  const schema = zodSchema as {
    shape?: Record<string, unknown>;
    _def?: { typeName?: string };
  };

  if (!schema.shape) {
    return { type: "object", properties: {} };
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(schema.shape)) {
    const fieldDef = value as {
      _def?: {
        typeName?: string;
        innerType?: unknown;
        description?: string;
        values?: string[];
        defaultValue?: unknown;
      };
      description?: string;
    };

    let fieldSchema: Record<string, unknown> = {};
    const def = fieldDef._def;

    if (def?.typeName === "ZodString") {
      fieldSchema = { type: "string" };
    } else if (def?.typeName === "ZodEnum") {
      fieldSchema = { type: "string", enum: def.values };
    } else if (def?.typeName === "ZodBoolean") {
      fieldSchema = { type: "boolean" };
    } else if (def?.typeName === "ZodOptional") {
      const innerDef = def.innerType as {
        _def?: { typeName?: string; values?: string[]; description?: string };
      };
      if (innerDef?._def?.typeName === "ZodString") {
        fieldSchema = { type: "string" };
      } else if (innerDef?._def?.typeName === "ZodEnum") {
        fieldSchema = { type: "string", enum: innerDef._def.values };
      } else {
        fieldSchema = { type: "string" };
      }
      if (innerDef?._def?.description) {
        fieldSchema.description = innerDef._def.description;
      }
    } else if (def?.typeName === "ZodDefault") {
      const innerDef = def.innerType as {
        _def?: { typeName?: string; innerType?: unknown; description?: string };
      };
      if (innerDef?._def?.typeName === "ZodBoolean") {
        fieldSchema = { type: "boolean", default: def.defaultValue };
      } else {
        fieldSchema = { type: "string" };
      }
    } else {
      fieldSchema = { type: "string" };
    }

    if (def?.description) {
      fieldSchema.description = def.description;
    }

    properties[key] = fieldSchema;

    // Check if required (not optional and no default)
    if (def?.typeName !== "ZodOptional" && def?.typeName !== "ZodDefault") {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

// Note: Watcher functionality has been integrated into orche-process.ts
// No separate watcher process is needed anymore

async function main() {
  const { role, workerId } = parseArgs();

  console.error(`Starting MCP server with role: ${role}`);
  if (workerId) {
    console.error(`Worker ID: ${workerId}`);
  }

  // Start socket server if orche role
  if (role === "orche") {
    // Start socket server for orche
    const socketServer = getSocketServer();
    await socketServer.start();
    console.error("Socket server started");

    // Setup socket message handler for orche
    setupOrcheSocketHandler();

    // Cleanup on exit
    process.on("exit", () => {
      cleanupSocket();
    });
    process.on("SIGINT", () => {
      cleanupSocket().then(() => process.exit(0));
    });
    process.on("SIGTERM", () => {
      cleanupSocket().then(() => process.exit(0));
    });
  } else {
    // Start socket client for planner/reviewer/worker
    const clientId = workerId || role;
    const socketClient = getSocketClient(clientId, role);
    await socketClient.connect();
    console.error(`Socket client connected for ${role} (${clientId})`);

    // Setup socket message handler based on role
    if (role === "worker") {
      setupSocketMessageHandler();
    } else if (role === "planner") {
      setupPlannerSocketHandler();
    } else if (role === "reviewer") {
      setupReviewerSocketHandler();
    }

    // Cleanup on exit
    process.on("exit", () => {
      cleanupSocket();
    });
    process.on("SIGINT", () => {
      cleanupSocket().then(() => process.exit(0));
    });
    process.on("SIGTERM", () => {
      cleanupSocket().then(() => process.exit(0));
    });
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
