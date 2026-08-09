import { StoryNodeType } from '../types/nodes';
import { BLUEPRINT_COMMAND_FORMAT, BLUEPRINT_COMMAND_VERSION } from './blueprintCommands';

const stableIdPatterns = {
  node: '^n_[a-z0-9][a-z0-9_-]{2,}$',
  variable: '^v_[a-z0-9][a-z0-9_-]{2,}$',
  line: '^ln_[a-z0-9][a-z0-9_-]{2,}$',
  text: '^t_[a-z0-9][a-z0-9_-]{2,}$',
  option: '^o_[a-z0-9][a-z0-9_-]{2,}$',
  character: '^c_[a-z0-9][a-z0-9_-]{2,}$',
} as const;

const graph = { $ref: '#/$defs/graphTarget' } as const;
const operationId = { type: 'string', minLength: 1 } as const;

function operation(kind: string, properties: Record<string, unknown>, required: readonly string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['operationId', 'kind', ...required],
    properties: {
      operationId,
      kind: { const: kind },
      ...properties,
    },
  } as const;
}

/** Draft 2020-12 schema copied into AI prompts and usable by external structured-output clients. */
export const BLUEPRINT_COMMAND_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://story-blueprint.dev/schema/blueprint-command-v1.json',
  title: 'Story Blueprint Command Transaction',
  type: 'object',
  additionalProperties: false,
  required: ['format', 'version', 'baseRevision', 'operations'],
  properties: {
    format: { const: BLUEPRINT_COMMAND_FORMAT },
    version: { const: BLUEPRINT_COMMAND_VERSION },
    baseRevision: { type: 'string', pattern: '^rev_[a-z0-9]+$' },
    operations: {
      type: 'array',
      items: {
        oneOf: [
          operation(
            'add-node',
            {
              graph,
              node: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'type', 'data'],
                properties: {
                  id: { type: 'string', pattern: stableIdPatterns.node },
                  type: { enum: Object.values(StoryNodeType) },
                  name: { type: 'string' },
                  data: { type: 'object' },
                },
              },
            },
            ['graph', 'node'],
          ),
          operation(
            'update-node',
            {
              graph,
              nodeId: { type: 'string', pattern: stableIdPatterns.node },
              patch: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: ['string', 'null'] },
                  data: { type: 'object' },
                },
              },
            },
            ['graph', 'nodeId', 'patch'],
          ),
          operation(
            'remove-node',
            { graph, nodeId: { type: 'string', pattern: stableIdPatterns.node } },
            ['graph', 'nodeId'],
          ),
          operation(
            'connect',
            {
              graph,
              from: { $ref: '#/$defs/endpoint' },
              to: { $ref: '#/$defs/endpoint' },
              replaceExisting: { type: 'boolean' },
            },
            ['graph', 'from', 'to'],
          ),
          operation(
            'disconnect',
            {
              graph,
              from: { $ref: '#/$defs/endpoint' },
              to: { $ref: '#/$defs/endpoint' },
            },
            ['graph', 'from', 'to'],
          ),
          operation('add-variable', { variable: { $ref: '#/$defs/variable' } }, ['variable']),
          operation(
            'update-variable',
            {
              variableId: { type: 'string', pattern: stableIdPatterns.variable },
              patch: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', minLength: 1 },
                  displayName: { type: 'string', minLength: 1 },
                  scope: { enum: ['project', 'story', 'chapter', 'local'] },
                  valueType: { $ref: '#/$defs/scalarValueType' },
                  defaultValue: { type: ['null', 'boolean', 'number', 'string'] },
                },
              },
            },
            ['variableId', 'patch'],
          ),
          operation(
            'add-dialogue-line',
            {
              graph,
              nodeId: { type: 'string', pattern: stableIdPatterns.node },
              afterLineId: { type: 'string', pattern: stableIdPatterns.line },
              line: { $ref: '#/$defs/dialogueLineInput' },
            },
            ['graph', 'nodeId', 'line'],
          ),
          operation(
            'update-dialogue-line',
            {
              graph,
              nodeId: { type: 'string', pattern: stableIdPatterns.node },
              lineId: { type: 'string', pattern: stableIdPatterns.line },
              patch: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  text: { type: 'string' },
                  speakerId: { type: ['string', 'null'] },
                  voiceId: { type: ['string', 'null'] },
                  emotion: { type: ['string', 'null'] },
                  tags: { type: 'array', items: { type: 'string' } },
                },
              },
            },
            ['graph', 'nodeId', 'lineId', 'patch'],
          ),
          operation(
            'remove-dialogue-line',
            {
              graph,
              nodeId: { type: 'string', pattern: stableIdPatterns.node },
              lineId: { type: 'string', pattern: stableIdPatterns.line },
            },
            ['graph', 'nodeId', 'lineId'],
          ),
          operation(
            'add-choice-option',
            {
              graph,
              nodeId: { type: 'string', pattern: stableIdPatterns.node },
              afterOptionId: { type: 'string', pattern: stableIdPatterns.option },
              option: { $ref: '#/$defs/choiceOptionInput' },
            },
            ['graph', 'nodeId', 'option'],
          ),
          operation(
            'update-choice-option',
            {
              graph,
              nodeId: { type: 'string', pattern: stableIdPatterns.node },
              optionId: { type: 'string', pattern: stableIdPatterns.option },
              patch: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  text: { type: 'string' },
                  visibleIf: { type: ['string', 'null'] },
                  enabledIf: { type: ['string', 'null'] },
                },
              },
            },
            ['graph', 'nodeId', 'optionId', 'patch'],
          ),
          operation(
            'remove-choice-option',
            {
              graph,
              nodeId: { type: 'string', pattern: stableIdPatterns.node },
              optionId: { type: 'string', pattern: stableIdPatterns.option },
            },
            ['graph', 'nodeId', 'optionId'],
          ),
          operation(
            'set-expression',
            {
              graph,
              nodeId: { type: 'string', pattern: stableIdPatterns.node },
              target: { $ref: '#/$defs/expressionTarget' },
              source: { type: ['string', 'null'] },
            },
            ['graph', 'nodeId', 'target', 'source'],
          ),
          operation('add-character', { character: { $ref: '#/$defs/character' } }, ['character']),
          operation(
            'update-character',
            {
              characterId: { type: 'string', pattern: stableIdPatterns.character },
              patch: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', minLength: 1 },
                  displayName: { type: 'string', minLength: 1 },
                  defaultPortraitId: {
                    type: ['string', 'null'],
                    pattern: '^a_[a-z0-9][a-z0-9_-]{2,}$',
                  },
                  emotions: { $ref: '#/$defs/emotions' },
                  fields: { type: 'array', items: { $ref: '#/$defs/characterField' } },
                },
              },
            },
            ['characterId', 'patch'],
          ),
          operation(
            'layout-selection',
            {
              graph,
              nodeIds: {
                type: 'array',
                minItems: 1,
                uniqueItems: true,
                items: { type: 'string', pattern: stableIdPatterns.node },
              },
            },
            ['graph', 'nodeIds'],
          ),
          operation(
            'layout-neighborhood',
            {
              graph,
              nodeIds: {
                type: 'array',
                minItems: 1,
                uniqueItems: true,
                items: { type: 'string', pattern: stableIdPatterns.node },
              },
            },
            ['graph', 'nodeIds'],
          ),
        ],
      },
    },
  },
  $defs: {
    graphTarget: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: { const: 'root' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'chapterId'],
          properties: {
            kind: { const: 'chapter' },
            chapterId: { type: 'string', pattern: '^ch_[a-z0-9][a-z0-9_-]{2,}$' },
          },
        },
      ],
    },
    endpoint: {
      type: 'object',
      additionalProperties: false,
      required: ['nodeId', 'portId'],
      properties: {
        nodeId: { type: 'string', pattern: stableIdPatterns.node },
        portId: { type: 'string', minLength: 1 },
      },
    },
    scalarValueType: {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { enum: ['boolean', 'number', 'string'] },
        nullable: { type: 'boolean' },
      },
    },
    variable: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'displayName', 'scope', 'valueType', 'defaultValue'],
      properties: {
        id: { type: 'string', pattern: stableIdPatterns.variable },
        name: { type: 'string', minLength: 1 },
        displayName: { type: 'string', minLength: 1 },
        scope: { enum: ['project', 'story', 'chapter', 'local'] },
        valueType: { $ref: '#/$defs/scalarValueType' },
        defaultValue: { type: ['null', 'boolean', 'number', 'string'] },
      },
    },
    characterField: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'displayName', 'scope', 'valueType', 'defaultValue'],
      properties: {
        id: { type: 'string', pattern: stableIdPatterns.variable },
        name: { type: 'string', minLength: 1 },
        displayName: { type: 'string', minLength: 1 },
        scope: { const: 'character' },
        valueType: { $ref: '#/$defs/scalarValueType' },
        defaultValue: { type: ['boolean', 'number', 'string'] },
      },
    },
    emotions: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['displayName'],
        properties: {
          displayName: { type: 'string', minLength: 1 },
          portraitId: { type: 'string', pattern: '^a_[a-z0-9][a-z0-9_-]{2,}$' },
        },
      },
    },
    character: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'displayName', 'emotions'],
      properties: {
        id: { type: 'string', pattern: stableIdPatterns.character },
        name: { type: 'string', minLength: 1 },
        displayName: { type: 'string', minLength: 1 },
        defaultPortraitId: { type: 'string', pattern: '^a_[a-z0-9][a-z0-9_-]{2,}$' },
        emotions: { $ref: '#/$defs/emotions' },
        fields: { type: 'array', items: { $ref: '#/$defs/characterField' } },
      },
    },
    dialogueLineInput: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'textId', 'text'],
      properties: {
        id: { type: 'string', pattern: stableIdPatterns.line },
        textId: { type: 'string', pattern: stableIdPatterns.text },
        text: { type: 'string' },
        speakerId: { type: 'string', pattern: '^c_[a-z0-9][a-z0-9_-]{2,}$' },
        voiceId: { type: 'string', pattern: '^a_[a-z0-9][a-z0-9_-]{2,}$' },
        emotion: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
    choiceOptionInput: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'text'],
      properties: {
        id: { type: 'string', pattern: stableIdPatterns.option },
        text: { type: 'string' },
        visibleIf: { type: 'string' },
        enabledIf: { type: 'string' },
      },
    },
    expressionTarget: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: { const: 'branch-condition' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: { kind: { const: 'set-variable-value' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'optionId'],
          properties: {
            kind: { enum: ['choice-visible', 'choice-enabled'] },
            optionId: { type: 'string', pattern: stableIdPatterns.option },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'parameterName'],
          properties: {
            kind: { enum: ['event-argument', 'signal-match'] },
            parameterName: { type: 'string', minLength: 1 },
          },
        },
      ],
    },
  },
} as const;

/** Exact authoring examples for add-node data. Ports are derived and must never be sent in a command. */
export const BLUEPRINT_NODE_CATALOG = [
  { type: StoryNodeType.Start, data: { title: 'New Story' }, inputPorts: [], outputPorts: ['out'] },
  {
    type: StoryNodeType.Dialogue,
    data: { lines: [{ id: 'ln_new_line', textId: 't_new_text', text: { source: 'Hello' } }] },
    inputPorts: ['in'],
    outputPorts: ['out'],
  },
  {
    type: StoryNodeType.Choice,
    data: {
      prompt: { source: 'Choose' },
      options: [{ id: 'o_new_option', text: { source: 'Option' } }],
    },
    inputPorts: ['in'],
    outputPorts: ['<option.id>'],
  },
  {
    type: StoryNodeType.Branch,
    data: { condition: { source: 'true', bindings: {} } },
    inputPorts: ['in'],
    outputPorts: ['true', 'false'],
  },
  {
    type: StoryNodeType.GetVariable,
    data: { variableId: 'v_existing' },
    inputPorts: [],
    outputPorts: ['value'],
  },
  {
    type: StoryNodeType.SetVariable,
    data: { variableId: 'v_existing', value: { source: '1', bindings: {} } },
    inputPorts: ['in'],
    outputPorts: ['out'],
  },
  {
    type: StoryNodeType.CallEvent,
    data: { eventId: 'ev_existing', arguments: {} },
    inputPorts: ['in'],
    outputPorts: ['out'],
  },
  {
    type: StoryNodeType.WaitSignal,
    data: { signalId: 'sig_existing', matches: {} },
    inputPorts: ['in'],
    outputPorts: ['out'],
  },
  {
    type: StoryNodeType.CallSubstory,
    data: { chapterId: 'ch_existing' },
    inputPorts: ['in'],
    outputPorts: ['out'],
  },
  { type: StoryNodeType.Reroute, data: {}, inputPorts: ['in'], outputPorts: ['out'] },
  {
    type: StoryNodeType.FlowAnchor,
    data: { label: 'Portal' },
    inputPorts: [],
    outputPorts: ['out'],
  },
  {
    type: StoryNodeType.FlowJump,
    data: { targetNodeId: 'n_existing_anchor' },
    inputPorts: ['in'],
    outputPorts: [],
  },
  { type: StoryNodeType.Return, data: {}, inputPorts: ['in'], outputPorts: [] },
  { type: StoryNodeType.End, data: { title: 'The End' }, inputPorts: ['in'], outputPorts: [] },
] as const;

export const BLUEPRINT_COMMAND_EXAMPLE = {
  format: BLUEPRINT_COMMAND_FORMAT,
  version: BLUEPRINT_COMMAND_VERSION,
  baseRevision: 'rev_current',
  operations: [
    {
      operationId: 'add-dialogue-1',
      kind: 'add-node',
      graph: { kind: 'root' },
      node: {
        id: 'n_ai_dialogue',
        type: StoryNodeType.Dialogue,
        data: {
          lines: [
            {
              id: 'ln_ai_line',
              textId: 't_ai_text',
              text: { source: 'A new line.' },
            },
          ],
        },
      },
    },
  ],
} as const;
