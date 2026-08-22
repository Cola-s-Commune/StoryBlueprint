const stableIdPrefixes = {
  project: 'prj',
  story: 's',
  chapter: 'ch',
  node: 'n',
  edge: 'e',
  variable: 'v',
  character: 'c',
  asset: 'a',
  event: 'ev',
  signal: 'sig',
  engineType: 'et',
  engineField: 'ef',
  line: 'ln',
  text: 't',
  option: 'o',
  program: 'p',
  block: 'b',
  instruction: 'i',
} as const;

export type StableIdKind = keyof typeof stableIdPrefixes;
export type StableId<Kind extends StableIdKind> = `${(typeof stableIdPrefixes)[Kind]}_${string}`;

export type StoryId = StableId<'story'>;
export type ProjectId = StableId<'project'>;
export type ChapterId = StableId<'chapter'>;
export type NodeId = StableId<'node'>;
export type EdgeId = StableId<'edge'>;
export type VariableId = StableId<'variable'>;
export type CharacterId = StableId<'character'>;
export type AssetId = StableId<'asset'>;
export type EventId = StableId<'event'>;
export type SignalId = StableId<'signal'>;
export type EngineTypeId = StableId<'engineType'>;
export type EngineFieldId = StableId<'engineField'>;
export type DialogueLineId = StableId<'line'>;
export type TextId = StableId<'text'>;
export type OptionId = StableId<'option'>;
export type ProgramId = StableId<'program'>;
export type BlockId = StableId<'block'>;
export type InstructionId = StableId<'instruction'>;

export interface NamedObject<Id extends string> {
  id: Id;
  name: string;
  displayName: string;
}

/** Generates a compact 64-bit Crockford Base32 identifier for local-first editing. */
export function createStableId<Kind extends StableIdKind>(kind: Kind): StableId<Kind> {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('A cryptographically secure getRandomValues implementation is required');
  }
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let suffix = '';
  for (let index = 0; index < 13; index += 1) {
    suffix = alphabet[Number(value & 31n)] + suffix;
    value >>= 5n;
  }
  return `${stableIdPrefixes[kind]}_${suffix}` as StableId<Kind>;
}

export function isStableId<Kind extends StableIdKind>(
  value: string,
  kind: Kind,
): value is StableId<Kind> {
  return new RegExp(`^${stableIdPrefixes[kind]}_[a-z0-9][a-z0-9_-]{2,}$`).test(value);
}
