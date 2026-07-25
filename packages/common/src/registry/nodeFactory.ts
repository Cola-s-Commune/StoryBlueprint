import { type StoryNodeType, type StoryNodeDataMap } from '../types/nodes';
import { createStableId, type NodeId } from '../types/ids';
import { nodeRegistry } from './nodeRegistry';

/**
 * Creates a plain data object representing a new node
 * instance ready for insertion into the React Flow graph.
 */
export interface NodeInstance {
  /** Unique instance ID (caller should generate) */
  id: NodeId;
  /** The StoryNodeType discriminator */
  type: StoryNodeType;
  /** Version of the node definition used to create this instance. */
  definitionVersion: number;
  /** Canvas position */
  position: { x: number; y: number };
  /** Typed data for this node type */
  data: StoryNodeDataMap[StoryNodeType];
}

/**
 * NodeFactory creates node data instances from
 * registered type definitions.
 */
export class NodeFactory {
  /**
   * Create a new node instance of the given type.
   * Returns null if the type is not registered.
   */
  static create<T extends StoryNodeType>(
    id: NodeId,
    type: T,
    position: { x: number; y: number },
  ): NodeInstance | null {
    const def = nodeRegistry.get(type);
    if (!def) return null;

    return {
      id,
      type,
      definitionVersion: def.version,
      position,
      data: def.defaultData() as StoryNodeDataMap[StoryNodeType],
    };
  }

  /**
   * Generate a unique node ID with an optional prefix.
   */
  static generateId(_type: StoryNodeType): NodeId {
    return createStableId('node');
  }
}
