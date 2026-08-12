export interface HistoryEntry<State> {
  state: State;
  label: string;
}

const cloneState = <State>(state: State): State => structuredClone(state);

export class GraphHistory<State> {
  private readonly past: HistoryEntry<State>[] = [];
  private readonly future: HistoryEntry<State>[] = [];

  constructor(private readonly limit = 100) {}

  checkpoint(state: State, label = 'Edit'): void {
    this.past.push({ state: cloneState(state), label });
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
  }

  undo(current: State): HistoryEntry<State> | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push({ state: cloneState(current), label: previous.label });
    return { state: cloneState(previous.state), label: previous.label };
  }

  redo(current: State): HistoryEntry<State> | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push({ state: cloneState(current), label: next.label });
    return { state: cloneState(next.state), label: next.label };
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get undoLabel(): string | undefined {
    return this.past.at(-1)?.label;
  }
  get redoLabel(): string | undefined {
    return this.future.at(-1)?.label;
  }
}
