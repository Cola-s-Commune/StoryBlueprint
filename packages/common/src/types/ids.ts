/** Stable identifiers are persisted and must never be derived from display text or position. */
export type StableId<Prefix extends string> = `${Prefix}_${string}`;

export type StoryId = StableId<'story'>;
export type ChapterId = StableId<'chapter'>;
export type NodeId = StableId<'node'>;
export type EdgeId = StableId<'edge'>;
export type VariableId = StableId<'variable'>;
export type CharacterId = StableId<'character'>;
export type AssetId = StableId<'asset'>;
export type EventId = StableId<'event'>;
export type TextId = StableId<'text'>;
export type OptionId = StableId<'option'>;
export type ProgramId = StableId<'program'>;
export type BlockId = StableId<'block'>;
export type InstructionId = StableId<'instruction'>;

export interface NamedObject<Id extends string> {
  id: Id;
  /** Unique, author-facing symbol name within its scope. */
  name: string;
  /** UI-facing name. It may be localized and is never used as a reference. */
  displayName: string;
}

export function createStableId<Prefix extends string>(prefix: Prefix): StableId<Prefix> {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) {
    throw new Error('A cryptographically secure randomUUID implementation is required');
  }
  return `${prefix}_${uuid}`;
}

export function isStableId<Prefix extends string>(
  value: string,
  prefix: Prefix,
): value is StableId<Prefix> {
  return value.startsWith(`${prefix}_`) && value.length > prefix.length + 1;
}
