import type { RuntimeValue, ValueType } from './values';

export interface CharacterTemplateField {
  name: string;
  displayName: string;
  valueType: ValueType;
  defaultValue: RuntimeValue;
}

export interface CharacterTemplateSource {
  name: string;
  displayName: string;
  description?: string;
  dialogueStyle?: string;
  tags?: readonly string[];
  metadata?: Readonly<Record<string, string | number | boolean>>;
  emotions: Readonly<Record<string, { displayName: string }>>;
  fields?: readonly CharacterTemplateField[];
}
