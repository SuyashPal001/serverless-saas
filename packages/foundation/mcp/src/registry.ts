import type {
  McpToolDefinition,
  McpToolCallRequest,
  McpToolCallResponse,
  McpAuthContext,
} from './types';

export type ToolHandler = (
  args: Record<string, unknown>,
  auth: McpAuthContext,
) => Promise<McpToolCallResponse>;

interface RegisteredTool {
  definition: McpToolDefinition;
  handler: ToolHandler;
}

export class McpToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  register(definition: McpToolDefinition, handler: ToolHandler): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`MCP tool already registered: ${definition.name}`);
    }
    this.tools.set(definition.name, { definition, handler });
  }

  getDefinitions(): McpToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  getDefinition(name: string): McpToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  hasPermission(toolName: string, permissions: string[]): boolean {
    const tool = this.tools.get(toolName);
    if (!tool) return false;
    return tool.definition.requiredPermissions.every((p) => permissions.includes(p));
  }

  async execute(
    request: McpToolCallRequest,
    auth: McpAuthContext,
  ): Promise<McpToolCallResponse> {
    const tool = this.tools.get(request.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${request.name}` }],
        isError: true,
      };
    }

    if (!this.hasPermission(request.name, auth.permissions)) {
      return {
        content: [{ type: 'text', text: `Permission denied for tool: ${request.name}` }],
        isError: true,
      };
    }

    try {
      return await tool.handler(request.arguments, auth);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: `Tool execution failed: ${message}` }],
        isError: true,
      };
    }
  }
}

/** Singleton registry */
let registry: McpToolRegistry | null = null;

export const getMcpRegistry = (): McpToolRegistry => {
  if (!registry) {
    registry = new McpToolRegistry();
  }
  return registry;
};

export const resetMcpRegistry = (): void => {
  registry = null;
};
