export interface HistoryEntry<State> {
  state: State;
  label: string;
}

export interface HistoryNavigationEntry {
  label: string;
  steps: number;
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

  travel(current: State, steps: number): HistoryEntry<State> | null {
    if (!Number.isInteger(steps) || steps === 0) return null;
    let state = current;
    let result: HistoryEntry<State> | null = null;
    const direction = steps < 0 ? -1 : 1;
    for (let index = 0; index < Math.abs(steps); index += 1) {
      const entry = direction < 0 ? this.undo(state) : this.redo(state);
      if (!entry) break;
      state = entry.state;
      result = entry;
    }
    return result;
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
  get undoEntries(): readonly HistoryNavigationEntry[] {
    return this.past
      .map((entry, index) => ({ label: entry.label, steps: -(this.past.length - index) }))
      .reverse();
  }
  get redoEntries(): readonly HistoryNavigationEntry[] {
    return this.future
      .map((entry, index) => ({ label: entry.label, steps: this.future.length - index }))
      .reverse();
  }
}
