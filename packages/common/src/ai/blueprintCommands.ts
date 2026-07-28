import type { ChapterId, NodeId } from '../types/ids';
import type { StoryNodeDataMap, StoryNodeType } from '../types/nodes';

export const BLUEPRINT_COMMAND_FORMAT = 'story-blueprint-commands' as const;
export const BLUEPRINT_COMMAND_VERSION = 1 as const;

export type BlueprintGraphTarget = { kind: 'root' } | { kind: 'chapter'; chapterId: ChapterId };

interface BlueprintCommandBase {
  /** Unique within a transaction and suitable for future idempotency tracking. */
  operationId: string;
  graph: BlueprintGraphTarget;
}

export interface AddNodeCommand extends BlueprintCommandBase {
  kind: 'add-node';
  node: {
    id: NodeId;
    type: StoryNodeType;
    name?: string;
    data: StoryNodeDataMap[StoryNodeType];
  };
}

export interface UpdateNodeCommand extends BlueprintCommandBase {
  kind: 'update-node';
  nodeId: NodeId;
  patch: {
    /** Null explicitly removes the optional author-facing name. */
    name?: string | null;
    /** Shallow data patch; collection fields are replaced atomically. */
    data?: Partial<StoryNodeDataMap[StoryNodeType]>;
  };
}

export interface RemoveNodeCommand extends BlueprintCommandBase {
  kind: 'remove-node';
  nodeId: NodeId;
}

export interface ConnectNodesCommand extends BlueprintCommandBase {
  kind: 'connect';
  from: { nodeId: NodeId; portId: string };
  to: { nodeId: NodeId; portId: string };
  /** Explicitly replaces an occupied execution output or data input. */
  replaceExisting?: boolean;
}

export interface DisconnectNodesCommand extends BlueprintCommandBase {
  kind: 'disconnect';
  from: { nodeId: NodeId; portId: string };
  to: { nodeId: NodeId; portId: string };
}

export type BlueprintCommand =
  | AddNodeCommand
  | UpdateNodeCommand
  | RemoveNodeCommand
  | ConnectNodesCommand
  | DisconnectNodesCommand;

export interface BlueprintCommandTransaction {
  format: typeof BLUEPRINT_COMMAND_FORMAT;
  version: typeof BLUEPRINT_COMMAND_VERSION;
  /** Rejects edits based on a stale Semantic Snapshot. */
  baseRevision?: string;
  operations: readonly BlueprintCommand[];
}

export type BlueprintCommandDiagnosticCode =
  | 'INVALID_TRANSACTION'
  | 'REVISION_CONFLICT'
  | 'DUPLICATE_OPERATION_ID'
  | 'UNKNOWN_GRAPH'
  | 'UNKNOWN_NODE'
  | 'DUPLICATE_NODE_ID'
  | 'UNKNOWN_CONNECTION'
  | 'INVALID_CONNECTION'
  | 'INVALID_GRAPH';

export interface BlueprintCommandDiagnostic {
  code: BlueprintCommandDiagnosticCode;
  message: string;
  operationId?: string;
  operationIndex?: number;
  path?: string;
}
