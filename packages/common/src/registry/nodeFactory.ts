import {
  type StoryNodeType,
  type StoryNodeDataMap,
} from '../types/nodes';
import { nodeRegistry } from './nodeRegistry';

/**
 * Creates a plain data object representing a new node
 * instance ready for insertion into the React Flow graph.
 */
export interface NodeInstance {
  /** Unique instance ID (caller should generate) */
  id: string;
  /** The StoryNodeType discriminator */
  type: StoryNodeType;
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
    id: string,
    type: T,
    position: { x: number; y: number },
  ): NodeInstance | null {
    const def = nodeRegistry.get(type);
    if (!def) return null;

    return {
      id,
      type,
      position,
      data: def.defaultData() as StoryNodeDataMap[StoryNodeType],
    };
  }

  /**
   * Generate a unique node ID with an optional prefix.
   */
  static generateId(type: StoryNodeType): string {
    return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
