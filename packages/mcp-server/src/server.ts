import { nodeRegistry } from '@story-blueprint/common';
import { StdioTransport } from './protocol/stdioTransport';
import type {
  JsonRpcRequest,
  JsonRpcNotification,
  InitializeParams,
  InitializeResult,
  ListToolsResult,
  CallToolParams,
  CallToolResult,
  ListPromptsResult,
  GetPromptParams,
} from './protocol/mcpTypes';
import { JSON_RPC_ERRORS, MCP_PROTOCOL_VERSION } from './protocol/mcpTypes';
import { storyReadContextTool, handleReadStoryContext } from './tools/storyReadContext';
import { storyDryRunTool, handleStoryDryRun } from './tools/storyDryRun';
import { storyApplyTool, handleStoryApply } from './tools/storyApply';
import { storyCompileTool, handleStoryCompile } from './tools/storyCompile';
import { storySearchTool, handleStorySearch } from './tools/storySearch';
import { storyInspectProjectTool, handleInspectProject } from './tools/storyInspectProject';
import { storyExportInkTool, handleStoryExportInk } from './tools/storyExportInk';
import { storyPrompts, handleGetPrompt } from './prompts/storyPrompts';

export class StoryBlueprintMcpServer {
  private transport: StdioTransport;
  private tools = [
    storyReadContextTool,
    storyDryRunTool,
    storyApplyTool,
    storyCompileTool,
    storySearchTool,
    storyInspectProjectTool,
    storyExportInkTool,
  ];

  constructor(transport?: StdioTransport) {
    nodeRegistry.registerBuiltins();
    this.transport = transport ?? new StdioTransport();
  }

  public start(): void {
    this.transport.start(async (message) => {
      await this.handleMessage(message);
    });
    console.error('[StoryBlueprint MCP] Server started on stdio transport');
  }

  public async handleMessage(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    const isNotification = !('id' in message) || message.id === undefined || message.id === null;
    const id = ('id' in message ? message.id : null) as string | number | null;

    try {
      switch (message.method) {
        case 'initialize': {
          const _params = message.params as InitializeParams;
          const result: InitializeResult = {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: false },
              prompts: { listChanged: false },
            },
            serverInfo: {
              name: 'story-blueprint-mcp',
              version: '0.1.0',
            },
          };
          if (!isNotification && id !== null) {
            this.transport.sendResponse(id, result);
          }
          break;
        }

        case 'notifications/initialized': {
          // Client acknowledged initialization
          break;
        }

        case 'ping': {
          if (!isNotification && id !== null) {
            this.transport.sendResponse(id, {});
          }
          break;
        }

        case 'tools/list': {
          const result: ListToolsResult = {
            tools: this.tools,
          };
          if (!isNotification && id !== null) {
            this.transport.sendResponse(id, result);
          }
          break;
        }

        case 'tools/call': {
          if (isNotification || id === null) break;
          const params = (message.params || {}) as CallToolParams;
          const toolResult = await this.executeTool(params.name, params.arguments || {});
          this.transport.sendResponse(id, toolResult);
          break;
        }

        case 'prompts/list': {
          const result: ListPromptsResult = {
            prompts: storyPrompts,
          };
          if (!isNotification && id !== null) {
            this.transport.sendResponse(id, result);
          }
          break;
        }

        case 'prompts/get': {
          if (isNotification || id === null) break;
          const params = (message.params || {}) as GetPromptParams;
          const promptResult = handleGetPrompt(params.name, params.arguments);
          if (!promptResult) {
            this.transport.sendError(id, JSON_RPC_ERRORS.INVALID_PARAMS, `Prompt not found: ${params.name}`);
          } else {
            this.transport.sendResponse(id, promptResult);
          }
          break;
        }

        default: {
          if (!isNotification && id !== null) {
            this.transport.sendError(
              id,
              JSON_RPC_ERRORS.METHOD_NOT_FOUND,
              `Method not found: ${message.method}`,
            );
          }
        }
      }
    } catch (err) {
      if (!isNotification && id !== null) {
        this.transport.sendError(
          id,
          JSON_RPC_ERRORS.INTERNAL_ERROR,
          `Internal server error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    try {
      switch (name) {
        case 'story_read_context': {
          const result = handleReadStoryContext(args as unknown as Parameters<typeof handleReadStoryContext>[0]);
          return {
            content: [{ type: 'text', text: result.content }],
            isError: !result.success,
          };
        }

        case 'story_dry_run_command': {
          const result = handleStoryDryRun(args as unknown as Parameters<typeof handleStoryDryRun>[0]);
          return {
            content: [{ type: 'text', text: result.content }],
            isError: !result.success,
          };
        }

        case 'story_apply_command': {
          const result = handleStoryApply(args as unknown as Parameters<typeof handleStoryApply>[0]);
          return {
            content: [{ type: 'text', text: result.content }],
            isError: !result.success,
          };
        }

        case 'story_compile': {
          const result = handleStoryCompile(args as unknown as Parameters<typeof handleStoryCompile>[0]);
          return {
            content: [{ type: 'text', text: result.content }],
            isError: !result.success,
          };
        }

        case 'story_search': {
          const result = handleStorySearch(args as unknown as Parameters<typeof handleStorySearch>[0]);
          return {
            content: [{ type: 'text', text: result.content }],
            isError: !result.success,
          };
        }

        case 'story_inspect_project': {
          const result = handleInspectProject(args as unknown as Parameters<typeof handleInspectProject>[0]);
          return {
            content: [{ type: 'text', text: result.content }],
            isError: !result.success,
          };
        }

        case 'story_export_ink': {
          const result = handleStoryExportInk(args as unknown as Parameters<typeof handleStoryExportInk>[0]);
          return {
            content: [{ type: 'text', text: result.content }],
            isError: !result.success,
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Tool execution error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
}
