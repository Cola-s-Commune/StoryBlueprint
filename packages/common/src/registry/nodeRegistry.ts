import { StoryNodeType, type NodeDefinition, type ChoiceOption } from '../types/nodes';
import { createStableId } from '../types/ids';

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
      version: 1,
      label: 'Story Entry',
      category: 'flow',
      color: '#4caf50',
      inputs: [],
      outputs: [{ id: 'out', label: 'Next', kind: 'execution', direction: 'output' }],
      defaultData: () => ({ title: 'New Story' }),
    });

    // Dialogue
    this.register<StoryNodeType.Dialogue>({
      type: StoryNodeType.Dialogue,
      version: 1,
      label: 'Dialogue',
      category: 'narrative',
      color: '#2196f3',
      inputs: [{ id: 'in', label: 'Prev', kind: 'execution', direction: 'input' }],
      outputs: [{ id: 'out', label: 'Next', kind: 'execution', direction: 'output' }],
      defaultData: () => ({
        text: { source: '' },
      }),
    });

    // Choice
    this.register<StoryNodeType.Choice>({
      type: StoryNodeType.Choice,
      version: 1,
      label: 'Choice',
      category: 'narrative',
      color: '#ff9800',
      inputs: [{ id: 'in', label: 'Prev', kind: 'execution', direction: 'input' }],
      outputs: [],
      dynamicOutputs: {
        sourceProperty: 'options',
        idProperty: 'id',
        labelProperty: 'text',
        kind: 'execution',
      },
      defaultData: () => ({
        prompt: { source: 'What will you do?' },
        options: [
          { text: { source: 'Option A' }, id: createStableId('option') },
          { text: { source: 'Option B' }, id: createStableId('option') },
        ] as ChoiceOption[],
      }),
    });

    // Branch
    this.register<StoryNodeType.Branch>({
      type: StoryNodeType.Branch,
      version: 1,
      label: 'Branch',
      category: 'logic',
      color: '#9c27b0',
      inputs: [{ id: 'in', label: 'Prev', kind: 'execution', direction: 'input' }],
      outputs: [
        { id: 'true', label: 'True', kind: 'execution', direction: 'output' },
        { id: 'false', label: 'False', kind: 'execution', direction: 'output' },
      ],
      defaultData: () => ({ condition: { source: 'true', bindings: {} } }),
    });

    this.register<StoryNodeType.GetVariable>({
      type: StoryNodeType.GetVariable,
      version: 1,
      label: 'Get Variable',
      category: 'logic',
      color: '#36b5a3',
      inputs: [],
      outputs: [
        {
          id: 'value',
          label: 'Value',
          kind: 'data',
          direction: 'output',
          valueType: { kind: 'any' },
        },
      ],
      defaultData: () => ({}),
    });

    this.register<StoryNodeType.SetVariable>({
      type: StoryNodeType.SetVariable,
      version: 1,
      label: 'Set Variable',
      category: 'logic',
      color: '#36b5a3',
      inputs: [{ id: 'in', label: 'Prev', kind: 'execution', direction: 'input' }],
      outputs: [{ id: 'out', label: 'Next', kind: 'execution', direction: 'output' }],
      defaultData: () => ({ value: { source: '', bindings: {} } }),
    });

    this.register<StoryNodeType.CallSubstory>({
      type: StoryNodeType.CallSubstory,
      version: 1,
      label: 'Call Substory',
      category: 'flow',
      color: '#5f88d1',
      inputs: [{ id: 'in', label: 'Prev', kind: 'execution', direction: 'input' }],
      outputs: [{ id: 'out', label: 'Completed', kind: 'execution', direction: 'output' }],
      defaultData: () => ({}),
    });

    this.register<StoryNodeType.Reroute>({
      type: StoryNodeType.Reroute,
      version: 1,
      label: 'Reroute',
      category: 'flow',
      color: '#8d99a8',
      inputs: [{ id: 'in', label: 'In', kind: 'execution', direction: 'input' }],
      outputs: [{ id: 'out', label: 'Out', kind: 'execution', direction: 'output' }],
      defaultData: () => ({}),
    });

    this.register<StoryNodeType.FlowAnchor>({
      type: StoryNodeType.FlowAnchor,
      version: 1,
      label: 'Flow Anchor',
      category: 'flow',
      color: '#38a6a5',
      inputs: [],
      outputs: [{ id: 'out', label: 'Continue', kind: 'execution', direction: 'output' }],
      defaultData: () => ({ label: 'Portal' }),
    });

    this.register<StoryNodeType.FlowJump>({
      type: StoryNodeType.FlowJump,
      version: 1,
      label: 'Flow Jump',
      category: 'flow',
      color: '#38a6a5',
      inputs: [{ id: 'in', label: 'Enter', kind: 'execution', direction: 'input' }],
      outputs: [],
      defaultData: () => ({}),
    });

    this.register<StoryNodeType.Return>({
      type: StoryNodeType.Return,
      version: 1,
      label: 'Return',
      category: 'flow',
      color: '#b67ad1',
      inputs: [{ id: 'in', label: 'Prev', kind: 'execution', direction: 'input' }],
      outputs: [],
      defaultData: () => ({}),
    });

    // End
    this.register<StoryNodeType.End>({
      type: StoryNodeType.End,
      version: 1,
      label: 'End Story',
      category: 'flow',
      color: '#f44336',
      inputs: [{ id: 'in', label: 'Prev', kind: 'execution', direction: 'input' }],
      outputs: [],
      defaultData: () => ({ title: 'The End' }),
    });
  }
}

/** Singleton instance — use this throughout the editor */
export const nodeRegistry = new NodeRegistry();
