/**
 * Model Context Protocol (MCP) Type Definitions
 * Following the MCP 2024-11-05 Specification
 */

export const MCP_PROTOCOL_VERSION = '2024-11-05';

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: TParams;
}

export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: TParams;
}

export interface JsonRpcSuccessResponse<TResult = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result: TResult;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse;

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ---- Server Capabilities & Initialization ----

export interface ServerCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  logging?: Record<string, unknown>;
}

export interface InitializeParams {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  clientInfo?: {
    name: string;
    version: string;
  };
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: {
    name: string;
    version: string;
  };
}

// ---- Tools ----

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

export interface ListToolsResult {
  tools: ToolDefinition[];
}

export interface CallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ToolContentItem {
  type: 'text';
  text: string;
}

export interface CallToolResult {
  content: ToolContentItem[];
  isError?: boolean;
}

// ---- Prompts ----

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptDefinition {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

export interface ListPromptsResult {
  prompts: PromptDefinition[];
}

export interface GetPromptParams {
  name: string;
  arguments?: Record<string, string>;
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text';
    text: string;
  };
}

export interface GetPromptResult {
  description?: string;
  messages: PromptMessage[];
}
