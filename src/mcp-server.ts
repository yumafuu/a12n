import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { orcheTools, orcheHandlers } from "./tools/orche.js";
import { workerTools, workerHandlers } from "./tools/worker.js";
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
  const tools = role === "orche" ? orcheTools : workerTools;
  const handlers = role === "orche" ? orcheHandlers : workerHandlers;

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
