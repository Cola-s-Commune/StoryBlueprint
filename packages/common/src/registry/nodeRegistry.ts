import {
  StoryNodeType,
  type NodeDefinition,
  type StoryNodeDataMap,
  type ChoiceOption,
} from '../types/nodes';

/**
 * Central registry for all node types available in the
 * story graph editor. Consumers register built-in and
 * plugin-defined node types; the editor queries the
 * registry to build the palette, create nodes, etc.
 */
export class NodeRegistry {
  private definitions = new Map<StoryNodeType, NodeDefinition>();

  // ---- CRUD ----

  /** Register a node definition. Overwrites if type already exists. */
  register<T extends StoryNodeType>(def: NodeDefinition<T>): void {
    this.definitions.set(def.type, def as unknown as NodeDefinition);
  }

  /** Remove a node type from the registry */
  unregister(type: StoryNodeType): void {
    this.definitions.delete(type);
  }

  /** Check if a node type is registered */
  has(type: StoryNodeType): boolean {
    return this.definitions.has(type);
  }

  /** Get the definition for a node type (undefined if not registered) */
  get<T extends StoryNodeType>(type: T): NodeDefinition<T> | undefined {
    return this.definitions.get(type) as NodeDefinition<T> | undefined;
  }

  /** Return all registered definitions */
  list(): NodeDefinition[] {
    return Array.from(this.definitions.values());
  }

  /** Return definitions grouped by category */
  listByCategory(): Record<string, NodeDefinition[]> {
    const grouped: Record<string, NodeDefinition[]> = {};
    for (const def of this.definitions.values()) {
      const cat = def.category;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(def);
    }
    return grouped;
  }

  // ---- Built-in defaults ----

  /**
   * Register all built-in node types.
   * Call this once during app initialization.
   */
  registerBuiltins(): void {
    // Start
    this.register<StoryNodeType.Start>({
      type: StoryNodeType.Start,
      label: 'Start',
      category: 'flow',
      color: '#4caf50',
      inputs: [],
      outputs: [{ id: 'out', label: 'Next' }],
      defaultData: () => ({ title: 'New Story' }),
    });

    // Dialogue
    this.register<StoryNodeType.Dialogue>({
      type: StoryNodeType.Dialogue,
      label: 'Dialogue',
      category: 'narrative',
      color: '#2196f3',
      inputs: [{ id: 'in', label: 'Prev' }],
      outputs: [{ id: 'out', label: 'Next' }],
      defaultData: () => ({
        speaker: 'Character',
        text: '',
      }),
    });

    // Choice
    this.register<StoryNodeType.Choice>({
      type: StoryNodeType.Choice,
      label: 'Choice',
      category: 'narrative',
      color: '#ff9800',
      inputs: [{ id: 'in', label: 'Prev' }],
      outputs: [
        { id: 'opt-a', label: 'Option A' },
        { id: 'opt-b', label: 'Option B' },
      ],
      defaultData: () => ({
        prompt: 'What will you do?',
        options: [
          { label: 'Option A', id: 'opt-a' },
          { label: 'Option B', id: 'opt-b' },
        ] as ChoiceOption[],
      }),
    });

    // Branch
    this.register<StoryNodeType.Branch>({
      type: StoryNodeType.Branch,
      label: 'Branch',
      category: 'logic',
      color: '#9c27b0',
      inputs: [{ id: 'in', label: 'Prev' }],
      outputs: [
        { id: 'true', label: 'True' },
        { id: 'false', label: 'False' },
      ],
      defaultData: () => ({ condition: 'someCondition' }),
    });

    // End
    this.register<StoryNodeType.End>({
      type: StoryNodeType.End,
      label: 'End',
      category: 'flow',
      color: '#f44336',
      inputs: [{ id: 'in', label: 'Prev' }],
      outputs: [],
      defaultData: () => ({ title: 'The End' }),
    });
  }
}

/** Singleton instance — use this throughout the editor */
export const nodeRegistry = new NodeRegistry();
