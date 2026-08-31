import type { ConditionId } from './types/ids';
import type { ConditionSource, ConditionTreeNode } from './types/source';

/**
 * Finds the first cycle in the graph formed by reusable condition references.
 *
 * A reference cycle has no meaningful boolean value, even when it appears under
 * a short-circuiting All/Any node, so callers should reject the document rather
 * than trying to evaluate it at runtime.
 */
export function findConditionReferenceCycle(
  conditions: readonly ConditionSource[],
): readonly ConditionId[] | undefined {
  const byId = new Map(conditions.map((condition) => [condition.id, condition]));
  const state = new Map<ConditionId, 'visiting' | 'visited'>();
  const stack: ConditionId[] = [];

  const referencesInTree = (
    tree: ConditionTreeNode,
    visit: (id: ConditionId) => readonly ConditionId[] | undefined,
  ): readonly ConditionId[] | undefined => {
    if (tree.kind === 'reference') return visit(tree.conditionId);
    if (tree.kind === 'not') return referencesInTree(tree.child, visit);
    if (tree.kind === 'all' || tree.kind === 'any') {
      for (const child of tree.children) {
        const cycle = referencesInTree(child, visit);
        if (cycle) return cycle;
      }
    }
    return undefined;
  };

  const visit = (id: ConditionId): readonly ConditionId[] | undefined => {
    const currentState = state.get(id);
    if (currentState === 'visiting') {
      const cycleStart = stack.indexOf(id);
      return [...stack.slice(cycleStart < 0 ? 0 : cycleStart), id];
    }
    if (currentState === 'visited') return undefined;

    const condition = byId.get(id);
    if (!condition) return undefined;
    state.set(id, 'visiting');
    stack.push(id);
    const cycle = referencesInTree(condition.root, visit);
    stack.pop();
    state.set(id, 'visited');
    return cycle;
  };

  for (const condition of conditions) {
    const cycle = visit(condition.id);
    if (cycle) return cycle;
  }
  return undefined;
}
