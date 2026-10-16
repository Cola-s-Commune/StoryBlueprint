const fs = require('node:fs');
const path = require('node:path');

const number = { kind: 'number' };
const boolean = { kind: 'boolean' };
const string = { kind: 'string' };
const array = { kind: 'array', elementType: number };
const map = { kind: 'map', keyType: 'number', valueType: number };
const struct = { kind: 'struct', name: 'Stats', fields: { reputation: number } };
const literal = (value, valueType) => ({ kind: 'literal', value, valueType });
const n = (value) => literal(value, number);
const b = (value) => literal(value, boolean);
const s = (value) => literal(value, string);
const variable = (variableId, valueType) => ({ kind: 'variable', variableId, valueType });
const unary = (operator, operand, valueType) => ({ kind: 'unary', operator, operand, valueType });
const binary = (operator, left, right, valueType) => ({
  kind: 'binary',
  operator,
  left,
  right,
  valueType,
});
const convert = (target, to) => ({ kind: 'convert', target, to, valueType: to });
const index = (target, key, valueType = number) => ({
  kind: 'index',
  target,
  index: key,
  valueType,
});
const member = (target, name, valueType = number) => ({
  kind: 'member',
  target,
  member: name,
  valueType,
});
const text = (id, ...parts) => ({
  id,
  parts: parts.map((part) =>
    typeof part === 'string'
      ? { kind: 'text', value: part }
      : { kind: 'expression', expression: part },
  ),
});
const divisionByZero = binary('divide', n(1), n(0), number);
const unreachable = binary('greater-than', divisionByZero, n(0), boolean);
const gold = variable('v_condition_gold', number);
const program = (id, blocks, variables = []) => ({
  format: 'story-runtime',
  version: 7,
  id,
  contentVersion: 'ue-contract-v1',
  entryBlockId: 'b_entry',
  blocks,
  chapters: {},
  variables,
});
const block = (id, ...instructions) => ({ id, instructions });
const end = (id) => ({ id, op: 'end-story' });
const variableDefinition = (id, valueType, defaultValue) => ({
  id,
  name: id,
  displayName: id,
  scope: 'story',
  valueType,
  defaultValue,
});

const conditions = program(
  'p_conditions',
  {
    b_entry: block(
      'b_entry',
      {
        id: 'i_add_gold',
        op: 'set-variable',
        variableId: 'v_condition_gold',
        value: binary('add', gold, n(5), number),
      },
      {
        id: 'i_branch_main',
        op: 'branch',
        condition: binary(
          'and',
          binary('greater-than-or-equal', gold, n(15), boolean),
          unary('not', b(false), boolean),
          boolean,
        ),
        whenTrue: 'b_choice',
        whenFalse: 'b_failure',
      },
    ),
    b_choice: block('b_choice', {
      id: 'i_choice_conditions',
      op: 'choice',
      prompt: text('t_condition_prompt', 'gold=', gold),
      options: [
        {
          id: 'opt_hidden',
          text: text('t_hidden', 'Hidden'),
          target: 'b_failure',
          visibleIf: b(false),
          enabledIf: unreachable,
        },
        {
          id: 'opt_locked',
          text: text('t_locked', 'Locked'),
          target: 'b_failure',
          enabledIf: binary('less-than', gold, n(0), boolean),
        },
        {
          id: 'opt_ready',
          text: text('t_ready', 'Ready ', gold),
          target: 'b_result',
          enabledIf: binary('or', b(true), unreachable, boolean),
        },
      ],
    }),
    b_result: block(
      'b_result',
      {
        id: 'i_result_dialogue',
        op: 'dialogue',
        text: text(
          't_result',
          'gold=',
          gold,
          '; member=',
          member(variable('v_stats', struct), 'reputation'),
          '; index=',
          index(variable('v_basket', array), n(1)),
          '; map=',
          index(variable('v_costs', map), n(42)),
          '; hex=',
          convert(s('0x10'), number),
          '; concat=',
          binary('add', s('A'), s('B'), string),
          '; null=',
          literal(null, { kind: 'string', nullable: true }),
          '; decimal=',
          n(0.1),
        ),
      },
      end('i_result_end'),
    ),
    b_failure: block(
      'b_failure',
      { id: 'i_failure_dialogue', op: 'dialogue', text: text('t_failure', 'Unexpected branch') },
      end('i_failure_end'),
    ),
  },
  [
    variableDefinition('v_condition_gold', number, 10),
    variableDefinition('v_stats', struct, { reputation: 12 }),
    variableDefinition('v_basket', array, [3, 8]),
    variableDefinition('v_costs', map, { 42: 4 }),
  ],
);

const alternate = program('p_alternate', {
  b_entry: block('b_entry', {
    id: 'i_branch_false',
    op: 'branch',
    condition: b(false),
    whenTrue: 'b_wrong',
    whenFalse: 'b_alt',
  }),
  b_alt: block(
    'b_alt',
    { id: 'i_alternate_dialogue', op: 'narration', text: text('t_alternate', 'Alternate Story') },
    end('i_alternate_end'),
  ),
  b_wrong: block('b_wrong', end('i_wrong_end')),
});
const story = (storyId, program) => ({
  storyId,
  name: storyId,
  displayName: storyId,
  program,
  characters: [],
  assets: [],
});
const project = {
  format: 'story-blueprint-compiled-project',
  version: 1,
  projectId: 'p_ue_contract',
  name: 'ue-contract',
  displayName: 'UE Runtime Contract',
  contentVersion: 'ue-contract-v1',
  entryStoryId: 's_conditions',
  events: [],
  signals: [],
  stories: {
    s_conditions: story('s_conditions', conditions),
    s_alternate: story('s_alternate', alternate),
  },
};

const cases = [];
const success = (name, expression, expected) =>
  cases.push({ name, expression, expected, expectedText: String(expected) });
const failure = (name, expression) => cases.push({ name, expression, expectedError: true });
for (const [op, a, c, expected] of [
  ['add', 2, 3, 5],
  ['subtract', 2, 3, -1],
  ['multiply', 2, 3, 6],
  ['divide', 7, 2, 3.5],
  ['modulo', -7, 3, -1],
])
  success(op, binary(op, n(a), n(c), number), expected);
for (const [op, a, c, expected] of [
  ['equal', 2, 2, true],
  ['not-equal', 2, 3, true],
  ['less-than', 2, 3, true],
  ['less-than-or-equal', 3, 3, true],
  ['greater-than', 3, 2, true],
  ['greater-than-or-equal', 3, 3, true],
])
  success(op, binary(op, n(a), n(c), boolean), expected);
success('string concatenation', binary('add', s('A'), s('B'), string), 'AB');
success('ordinal comparison', binary('less-than', s('Z'), s('a'), boolean), true);
success('negate', unary('negate', n(2), number), -2);
success('not', unary('not', b(true), boolean), false);
success('and short circuit', binary('and', b(false), unreachable, boolean), false);
success('or short circuit', binary('or', b(true), unreachable, boolean), true);
success('and evaluates right', binary('and', b(true), b(false), boolean), false);
success('or evaluates right', binary('or', b(false), b(true), boolean), true);
success('member', member(literal({ reputation: 12 }, struct), 'reputation'), 12);
success('array lookup', index(literal([3, 8], array), n(1)), 8);
success('numeric map key', index(literal({ 42: 4 }, map), n(42)), 4);
success('number text shortest', convert(n(0.1), string), '0.1');
success('number text fixed small', convert(n(1e-6), string), '0.000001');
success('number text exponent', convert(n(1e21), string), '1e+21');
success(
  'large number shortest significant digits',
  convert(n(1000000000000000100), string),
  '1000000000000000100',
);
success('number text negative zero', convert(n(-0), string), '0');
success('hexadecimal conversion', convert(s('0x10'), number), 16);
success('binary conversion', convert(s('0b101'), number), 5);
success('octal conversion', convert(s('0o17'), number), 15);
success('whitespace conversion', convert(s('  '), number), 0);
success('boolean conversion', convert(b(true), number), 1);
success('null number conversion', convert(literal(null, { kind: 'any' }), number), 0);
success('decimal underflow', convert(s('1e-400'), number), 0);
success('empty string is false', convert(s(''), boolean), false);
success('nonempty string zero is true', convert(s('0'), boolean), true);
success('empty array is true', convert(literal([], array), boolean), true);
success(
  'array string conversion',
  convert(
    literal([1, null, 3], { kind: 'array', elementType: { kind: 'number', nullable: true } }),
    string,
  ),
  '1,,3',
);
success(
  'object string conversion',
  convert(literal({ reputation: 12 }, struct), string),
  '[object Object]',
);
failure('division by zero', divisionByZero);
failure('modulo by zero', binary('modulo', n(1), n(0), number));
failure('numeric overflow', binary('multiply', n(1e308), n(10), number));
failure('missing member', member(literal({ reputation: 12 }, struct), 'missing'));
failure('missing map key', index(literal({ 42: 4 }, map), s('missing')));
failure('negative array index', index(literal([1], array), n(-1)));
failure('fractional array index', index(literal([1], array), n(0.5)));
failure('out of range array index', index(literal([1], array), n(1)));
failure('invalid numeric string', convert(s('12px'), number));
failure('invalid numeric signs', convert(s('+-1'), number));
failure('numeric string overflow', convert(s('1e400'), number));
cases.push({
  name: 'unknown variable',
  expression: variable('v_missing', number),
  expectedValidationError: true,
});
cases.push({
  name: 'output reference without producer context',
  expression: {
    kind: 'event-output',
    instructionId: 'i_event',
    outputId: 'evo_value',
    valueType: number,
  },
  expectedValidationError: true,
});
cases.push({
  name: 'unknown binary operator',
  expression: binary('power', n(2), n(3), number),
  expectedValidationError: true,
});
cases.push({
  name: 'opaque JSON member access',
  expression: member(literal({ value: 1 }, { kind: 'json', name: 'EngineObject' }), 'value'),
  expectedValidationError: true,
});

const fixtures = path.resolve(__dirname, '../Fixtures');
const output = (kind, instructionId, outputId, valueType) => ({
  kind,
  instructionId,
  outputId,
  valueType,
});
const eventOutput = (id, field, type) => output('event-output', id, field, type);
const signalOutput = (id, field, type) => output('signal-output', id, field, type);
const statusType = { kind: 'enum', name: 'RewardStatus', values: ['ok', 'bad'] };
const targetStatusType = { kind: 'enum', name: 'RewardStatus', values: ['ok'] };
const detailType = {
  kind: 'struct',
  name: 'EnemyDetail',
  fields: {
    tags: array,
    meta: { kind: 'struct', name: 'Location', fields: { zone: string } },
  },
};
const detail = { tags: [1, 2], meta: { zone: 'cave' } };
const rewardOutputs = [
  { id: 'evo_amount', name: 'amount', displayName: 'Amount', valueType: number },
  { id: 'evo_status', name: 'status', displayName: 'Status', valueType: statusType },
  { id: 'evo_success', name: 'success', displayName: 'Success', valueType: boolean },
];
const rewardEvent = (id, amount) => ({
  id,
  op: 'call-event',
  eventId: 'ev_reward',
  arguments: { amount },
  outputs: rewardOutputs,
  resultVariableIds: { evo_amount: 'v_reward', evo_status: 'v_reward_status' },
});
const waitEnemy = (id, bossId) => ({
  id,
  op: 'wait-signal',
  signalId: 'sig_enemy',
  matches: { bossId: s(bossId), detail: literal(detail, detailType) },
});
const jump = (id, target) => ({ id, op: 'jump', target });
const rewardVariables = [
  variableDefinition('v_reward', number, 0),
  variableDefinition('v_reward_status', targetStatusType, 'ok'),
];
const flow = program(
  'p_output_flow',
  {
    b_entry: block(
      'b_entry',
      { id: 'i_before_signal', op: 'dialogue', text: text('t_before_signal', 'Before signal') },
      jump('i_to_red', 'b_wait_red'),
    ),
    b_wait_red: block(
      'b_wait_red',
      waitEnemy('i_wait_red', 'red'),
      rewardEvent('i_reward', signalOutput('i_wait_red', 'score', number)),
      jump('i_to_report', 'b_report'),
    ),
    b_report: block(
      'b_report',
      {
        id: 'i_reward_report',
        op: 'dialogue',
        text: text(
          't_reward_report',
          'reward=',
          variable('v_reward', number),
          '; event=',
          eventOutput('i_reward', 'evo_amount', number),
          '; signal=',
          signalOutput('i_wait_red', 'score', number),
          '; status=',
          eventOutput('i_reward', 'evo_status', statusType),
          '; ok=',
          eventOutput('i_reward', 'evo_success', boolean),
        ),
      },
      jump('i_to_blue', 'b_wait_blue'),
    ),
    b_wait_blue: block(
      'b_wait_blue',
      waitEnemy('i_wait_blue', 'blue'),
      jump('i_to_blue_report', 'b_blue_report'),
    ),
    b_blue_report: block(
      'b_blue_report',
      {
        id: 'i_blue_report',
        op: 'dialogue',
        text: text('t_blue_report', 'blue=', signalOutput('i_wait_blue', 'score', number)),
      },
      jump('i_to_red_again', 'b_wait_red_again'),
    ),
    b_wait_red_again: block(
      'b_wait_red_again',
      waitEnemy('i_wait_red_again', 'red'),
      jump('i_to_red_report', 'b_red_report'),
    ),
    b_red_report: block(
      'b_red_report',
      {
        id: 'i_red_report',
        op: 'dialogue',
        text: text(
          't_red_report',
          'red2=',
          signalOutput('i_wait_red_again', 'score', number),
          '; cached=',
          eventOutput('i_reward', 'evo_amount', number),
        ),
      },
      end('i_flow_end'),
    ),
  },
  rewardVariables,
);
const repeat = program(
  'p_output_repeat',
  {
    b_entry: block('b_entry', rewardEvent('i_repeat', n(1)), jump('i_repeat_report', 'b_report')),
    b_report: block(
      'b_report',
      {
        id: 'i_repeat_dialogue',
        op: 'dialogue',
        text: text('t_repeat', 'value=', eventOutput('i_repeat', 'evo_amount', number)),
      },
      jump('i_repeat_loop', 'b_entry'),
    ),
  },
  rewardVariables,
);
const outputProject = {
  ...project,
  projectId: 'p_output_contract',
  name: 'output-contract',
  displayName: 'Event and Signal Contract',
  entryStoryId: 's_flow',
  events: [
    {
      id: 'ev_reward',
      name: 'reward',
      displayName: 'Reward',
      parameters: [{ name: 'amount', valueType: number }],
      outputs: rewardOutputs,
      resumable: false,
      sideEffect: 'write',
    },
  ],
  signals: [
    {
      id: 'sig_enemy',
      name: 'enemy',
      displayName: 'Enemy',
      parameters: [
        { name: 'bossId', valueType: string },
        { name: 'score', valueType: number },
        { name: 'detail', valueType: detailType },
      ],
    },
  ],
  stories: { s_flow: story('s_flow', flow), s_repeat: story('s_repeat', repeat) },
};
fs.mkdirSync(fixtures, { recursive: true });
fs.writeFileSync(
  path.join(fixtures, 'event-signal-project.storyc.json'),
  `${JSON.stringify(outputProject, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(fixtures, 'conditional-project.storyc.json'),
  `${JSON.stringify(project, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(fixtures, 'expression-cases.json'),
  `${JSON.stringify({ cases }, null, 2)}\n`,
);
