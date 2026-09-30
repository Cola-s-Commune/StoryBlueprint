import type { Readable, Writable } from 'node:stream';
import type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
} from './mcpTypes';
import { JSON_RPC_ERRORS } from './mcpTypes';

export class StdioTransport {
  private stdin: Readable;
  private stdout: Writable;
  private buffer = '';
  private messageHandler?: (message: JsonRpcRequest | JsonRpcNotification) => Promise<void> | void;

  constructor(stdin: Readable = process.stdin, stdout: Writable = process.stdout) {
    this.stdin = stdin;
    this.stdout = stdout;
  }

  public start(onMessage: (message: JsonRpcRequest | JsonRpcNotification) => Promise<void> | void): void {
    this.messageHandler = onMessage;
    this.stdin.setEncoding('utf-8');

    this.stdin.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.processBuffer();
    });

    this.stdin.on('error', (err) => {
      console.error('[MCP StdioTransport] stdin error:', err);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    // The last element is whatever remains after the last newline
    this.buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== 'object') {
          this.sendError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC message');
          continue;
        }

        const msg = parsed as Record<string, unknown>;
        if (msg.jsonrpc !== '2.0') {
          this.sendError(
            (msg.id as string | number) ?? null,
            JSON_RPC_ERRORS.INVALID_REQUEST,
            'Missing or invalid jsonrpc version (must be "2.0")',
          );
          continue;
        }

        if (typeof msg.method === 'string') {
          // Request or notification
          if (this.messageHandler) {
            void this.messageHandler(msg as unknown as JsonRpcRequest | JsonRpcNotification);
          }
        }
      } catch (err) {
        this.sendError(
          null,
          JSON_RPC_ERRORS.PARSE_ERROR,
          `Parse error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  public sendResponse<T>(id: string | number, result: T): void {
    const response: JsonRpcSuccessResponse<T> = {
      jsonrpc: '2.0',
      id,
      result,
    };
    this.write(response);
  }

  public sendError(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown,
  ): void {
    const response: JsonRpcErrorResponse = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        ...(data !== undefined ? { data } : {}),
      },
    };
    this.write(response);
  }

  public sendNotification<T>(method: string, params?: T): void {
    const notification: JsonRpcNotification<T> = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    };
    this.write(notification);
  }

  private write(msg: JsonRpcMessage): void {
    const serialized = JSON.stringify(msg) + '\n';
    this.stdout.write(serialized);
  }
}
