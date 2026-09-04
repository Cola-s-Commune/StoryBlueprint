import type { ValueType } from '@story-blueprint/common';

/** Stable visual language for data pins and data wires. Execution wires stay neutral. */
export const valueTypeColors: Record<ValueType['kind'], string> = {
  any: '#d3a85d',
  boolean: '#e56b6f',
  number: '#63c174',
  string: '#e58ab4',
  'character-ref': '#f0a769',
  'asset-ref': '#63c8d1',
  array: '#65aee8',
  map: '#9a83df',
  json: '#d9956d',
  enum: '#d8c85b',
  struct: '#d783bd',
};

export function valueTypeColor(type: ValueType | undefined): string {
  return valueTypeColors[type?.kind ?? 'any'];
}
