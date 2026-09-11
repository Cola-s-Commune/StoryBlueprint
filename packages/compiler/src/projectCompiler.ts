import {
  STORY_COMPILED_PROJECT_FORMAT,
  STORY_COMPILED_PROJECT_VERSION,
  StoryNodeType,
  createGraphConnectionValidator,
  nodeRegistry,
  localizationTranslationsForStory,
  resolveNodePorts,
  type ChapterId,
  type CompiledStoryProgram,
  type GraphNodeLike,
  type FlowJumpNodeData,
  type NodeId,
  type SourceGraph,
  type SourceNode,
  type StoryNodeDataMap,
  type StorySourceDocument,
  type StoryProjectDocument,
  type StoryId,
  type ProjectStoryReference,
  type StoryLocalizationDocument,
} from '@story-blueprint/common';
import { compileStory } from './storyCompiler';
import type {
  CompileProjectOptions,
  CompileProjectResult,
  ProjectCompiler,
  ProjectCompilerDiagnostic,
  ProjectStorySource,
} from './types';

nodeRegistry.registerBuiltins();

function contentHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `content-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function graphDiagnostics(
  graph: SourceGraph,
  story: ProjectStorySource,
  chapterId?: ChapterId,
): ProjectCompilerDiagnostic[] {
  const diagnostics: ProjectCompilerDiagnostic[] = [];
  const decorate = (
    diagnostic: Omit<ProjectCompilerDiagnostic, 'storyId' | 'storyPath' | 'storyName'>,
  ): ProjectCompilerDiagnostic => ({
    ...diagnostic,
    storyId: story.source.id,
    storyPath: story.path,
    storyName: story.source.displayName,
    sourceChapterId: chapterId,
  });
  const entries = graph.nodes.filter((node) => node.type === StoryNodeType.Start);
  if (entries.length > 1) {
    diagnostics.push(
      decorate({
        code: 'MULTIPLE_ENTRY_NODES',
        severity: 'error',
        message: `${chapterId ? 'Substory' : 'Story'} contains multiple entry nodes`,
        sourceNodeId: entries[1].id,
      }),
    );
  }

  const ownerChapter = chapterId
    ? story.source.chapters.find((chapter) => chapter.id === chapterId)
    : undefined;
  const graphNodes: GraphNodeLike[] = graph.nodes.map((node) => {
    let data = node.data as GraphNodeLike['data'];
    if (node.type === StoryNodeType.CallSubstory) {
      const call = node.data as unknown as StoryNodeDataMap[StoryNodeType.CallSubstory];
      const called = story.source.chapters.find((chapter) => chapter.id === call.chapterId);
      if (called) {
        data = {
          ...call,
          argumentInputTypes: Object.fromEntries(
            called.parameters.map((parameter) => [parameter.variable.id, parameter.variable.valueType]),
          ),
          outputPorts: called.outputs.map((output) => ({
            id: output.variable.id,
            label: output.variable.displayName,
            valueType: output.variable.valueType,
          })),
        };
      }
    } else if (node.type === StoryNodeType.Return && ownerChapter) {
      const returned = node.data as unknown as StoryNodeDataMap[StoryNodeType.Return];
      data = {
        ...returned,
        valueInputTypes: Object.fromEntries(
          ownerChapter.outputs.map((output) => [output.variable.id, output.variable.valueType]),
        ),
      };
    }
    return { id: node.id, type: node.type as StoryNodeType, data };
  });
  const validExecutionEdges: { source: string; target: string }[] = [];
  const connectionValidator = createGraphConnectionValidator(graphNodes);
  const graphNodesById = new Map(graphNodes.map((node) => [node.id, node] as const));
  const resolvedPortsByNodeId = new Map<string, ReturnType<typeof resolveNodePorts>>();
  for (const edge of graph.edges) {
    const candidate = {
      source: edge.from.nodeId,
      sourcePortId: edge.from.portId,
      target: edge.to.nodeId,
      targetPortId: edge.to.portId,
    };
    const validation = connectionValidator.validate(candidate);
    if (!validation.valid) {
      diagnostics.push(
        decorate({
          code: 'DANGLING_EDGE',
          severity: 'error',
          message: validation.diagnostic.message,
          sourceNodeId: edge.from.nodeId,
        }),
      );
      continue;
    }
    const sourceNode = graphNodesById.get(candidate.source);
    let sourceResolution = sourceNode ? resolvedPortsByNodeId.get(sourceNode.id) : undefined;
    if (sourceNode && !sourceResolution) {
      sourceResolution = resolveNodePorts(sourceNode);
      resolvedPortsByNodeId.set(sourceNode.id, sourceResolution);
    }
    const sourcePort = sourceResolution
      ? sourceResolution.ports.find((port: { id: string }) => port.id === candidate.sourcePortId)
      : undefined;
    if (sourcePort?.kind === 'execution') {
      validExecutionEdges.push({ source: candidate.source, target: candidate.target });
    }
  }
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const node of graph.nodes) {
    if (node.type !== StoryNodeType.FlowJump) continue;
    const targetNodeId = (node.data as FlowJumpNodeData).targetNodeId;
    const target = targetNodeId ? nodesById.get(targetNodeId) : undefined;
    if (!target || target.type !== StoryNodeType.FlowAnchor) {
      diagnostics.push(
        decorate({
          code: 'INVALID_NODE',
          severity: 'error',
          message: 'Flow Jump does not reference a Flow Anchor in the same graph',
          sourceNodeId: node.id,
        }),
      );
    } else {
      validExecutionEdges.push({ source: node.id, target: target.id });
    }
  }

  const reachable = new Set<string>();
  const visit = (nodeId: string) => {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);
    for (const edge of validExecutionEdges) if (edge.source === nodeId) visit(edge.target);
  };
  if (entries[0]) visit(entries[0].id);
  for (const node of graph.nodes) {
    if (node.type !== StoryNodeType.GetVariable && !reachable.has(node.id)) {
      diagnostics.push(
        decorate({
          code: 'UNREACHABLE_NODE',
          severity: 'warning',
          message: `${node.type} is not reachable from the entry node`,
          sourceNodeId: node.id,
        }),
      );
    }
    if (chapterId && node.type === StoryNodeType.End) {
      diagnostics.push(
        decorate({
          code: 'INVALID_END_LOCATION',
          severity: 'warning',
          message:
            'End Story inside a substory terminates the entire Story; use Return if intended',
          sourceNodeId: node.id,
        }),
      );
    }
  }

  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  let nextIndex = 0;
  const successors = (id: string) =>
    validExecutionEdges.filter((edge) => edge.source === id).map((edge) => edge.target);
  const strongConnect = (nodeId: string) => {
    indices.set(nodeId, nextIndex);
    lowLinks.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);
    for (const target of successors(nodeId)) {
      if (!indices.has(target)) {
        strongConnect(target);
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, lowLinks.get(target)!));
      } else if (onStack.has(target)) {
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, indices.get(target)!));
      }
    }
    if (lowLinks.get(nodeId) !== indices.get(nodeId)) return;
    const component: string[] = [];
    let current: string | undefined;
    do {
      current = stack.pop();
      if (!current) break;
      onStack.delete(current);
      component.push(current);
    } while (current !== nodeId);
    const cyclic =
      component.length > 1 ||
      (component.length === 1 && successors(component[0]).includes(component[0] as NodeId));
    const hasPause = component.some((id) => {
      const type = nodesById.get(id as NodeId)?.type;
      return (
        type === StoryNodeType.Dialogue ||
        type === StoryNodeType.Narration ||
        type === StoryNodeType.Choice ||
        type === StoryNodeType.WaitSignal
      );
    });
    if (cyclic && !hasPause) {
      diagnostics.push(
        decorate({
          code: 'TIGHT_LOOP',
          severity: 'error',
          message: 'Execution cycle has no dialogue, narration, choice, or signal pause point',
          sourceNodeId: component[0] as SourceNode['id'],
        }),
      );
    }
  };
  for (const nodeId of reachable) if (!indices.has(nodeId)) strongConnect(nodeId);
  return diagnostics;
}

/**
 * Finds recursive Call Substory dependencies. The first version of the runtime
 * has no recursion limit, so cycles are rejected during build instead of being
 * discovered only after the call stack grows during play.
 */
function substoryCallDiagnostics(
  source: StorySourceDocument,
  story: ProjectStorySource,
): ProjectCompilerDiagnostic[] {
  const diagnostics: ProjectCompilerDiagnostic[] = [];
  const chaptersById = new Map(source.chapters.map((chapter) => [chapter.id, chapter] as const));
  const adjacency = new Map<ChapterId, Set<ChapterId>>(
    source.chapters.map((chapter) => [chapter.id, new Set<ChapterId>()]),
  );
  const edgeNodes = new Map<string, NodeId>();

  for (const chapter of source.chapters) {
    for (const node of chapter.graph.nodes) {
      if (node.type !== StoryNodeType.CallSubstory) continue;
      const targetId = (node.data as { chapterId?: ChapterId }).chapterId;
      if (!targetId || !chaptersById.has(targetId)) continue;
      adjacency.get(chapter.id)!.add(targetId);
      const edgeKey = `${chapter.id}->${targetId}`;
      if (!edgeNodes.has(edgeKey)) edgeNodes.set(edgeKey, node.id);
    }
  }

  const indices = new Map<ChapterId, number>();
  const lowLinks = new Map<ChapterId, number>();
  const stack: ChapterId[] = [];
  const onStack = new Set<ChapterId>();
  let nextIndex = 0;
  const components: ChapterId[][] = [];
  const strongConnect = (chapterId: ChapterId) => {
    indices.set(chapterId, nextIndex);
    lowLinks.set(chapterId, nextIndex);
    nextIndex += 1;
    stack.push(chapterId);
    onStack.add(chapterId);
    for (const targetId of adjacency.get(chapterId) ?? []) {
      if (!indices.has(targetId)) {
        strongConnect(targetId);
        lowLinks.set(chapterId, Math.min(lowLinks.get(chapterId)!, lowLinks.get(targetId)!));
      } else if (onStack.has(targetId)) {
        lowLinks.set(chapterId, Math.min(lowLinks.get(chapterId)!, indices.get(targetId)!));
      }
    }
    if (lowLinks.get(chapterId) !== indices.get(chapterId)) return;
    const component: ChapterId[] = [];
    let current: ChapterId | undefined;
    do {
      current = stack.pop();
      if (!current) break;
      onStack.delete(current);
      component.push(current);
    } while (current !== chapterId);
    components.push(component);
  };
  for (const chapter of source.chapters) {
    if (!indices.has(chapter.id)) strongConnect(chapter.id);
  }

  for (const component of components) {
    const componentSet = new Set(component);
    const selfRecursive =
      component.length === 1 && (adjacency.get(component[0])?.has(component[0]) ?? false);
    if (component.length < 2 && !selfRecursive) continue;

    let cyclePath: ChapterId[] | undefined;
    let sourceNodeId: NodeId | undefined;
    const findCycle = (start: ChapterId, current: ChapterId, path: ChapterId[]): boolean => {
      for (const targetId of adjacency.get(current) ?? []) {
        if (!componentSet.has(targetId)) continue;
        if (targetId === start) {
          cyclePath = [...path, targetId];
          sourceNodeId = edgeNodes.get(`${current}->${targetId}`);
          return true;
        }
        if (path.includes(targetId)) continue;
        if (findCycle(start, targetId, [...path, targetId])) {
          if (!sourceNodeId) sourceNodeId = edgeNodes.get(`${current}->${targetId}`);
          return true;
        }
      }
      return false;
    };
    for (const start of component) {
      if (findCycle(start, start, [start])) break;
    }
    const ids = cyclePath ?? [...component, component[0]];
    const labels = ids.map((id) => chaptersById.get(id)?.displayName ?? id);
    diagnostics.push({
      code: 'SUBSTORY_CALL_CYCLE',
      severity: 'error',
      message: `Substory call cycle detected: ${labels.join(' -> ')}`,
      storyId: story.source.id,
      storyPath: story.path,
      storyName: story.source.displayName,
      sourceChapterId: sourceNodeId
        ? source.chapters.find((chapter) =>
            chapter.graph.nodes.some((node) => node.id === sourceNodeId),
          )?.id
        : component[0],
      sourceNodeId,
    });
  }
  return diagnostics;
}

export class DefaultProjectCompiler implements ProjectCompiler {
  compile(
    project: StoryProjectDocument,
    stories: readonly ProjectStorySource[],
    options: CompileProjectOptions = {},
  ): CompileProjectResult {
    const diagnostics: ProjectCompilerDiagnostic[] = [];
    const sourcesById = new Map<StoryId, ProjectStorySource>(
      stories.map((story: ProjectStorySource) => [story.source.id, story]),
    );
    const programs: Record<string, CompiledStoryProgram> = {};
    const entryStoryId = options.entryStoryId ?? project.entryStoryId ?? project.stories[0]?.id;
    if (
      !entryStoryId ||
      !project.stories.some((story: { id: StoryId }) => story.id === entryStoryId)
    ) {
      diagnostics.push({
        code: 'PROJECT_ERROR',
        severity: 'error',
        message: 'Project has no valid entry Story',
      });
    }

    for (const reference of project.stories) {
      const story = sourcesById.get(reference.id);
      if (!story) {
        diagnostics.push({
          code: 'MISSING_STORY',
          severity: 'error',
          message: `Project Story is missing: ${reference.path}`,
          storyId: reference.id,
          storyPath: reference.path,
          storyName: reference.displayName,
        });
        continue;
      }
      diagnostics.push(...graphDiagnostics(story.source.root, story));
      for (const chapter of story.source.chapters) {
        diagnostics.push(...graphDiagnostics(chapter.graph, story, chapter.id));
      }
      diagnostics.push(...substoryCallDiagnostics(story.source, story));
      const compiled = compileStory(
        {
          ...story.source,
          variables: [...story.source.variables, ...(project.variables ?? [])],
          events: project.events,
          signals: project.signals,
        },
        {
          ...options,
          availableStoryIds: project.stories.map((candidate: ProjectStoryReference) => candidate.id),
          storyVariablesById: Object.fromEntries(
            stories.map((candidate) => [
              candidate.source.id,
              [...candidate.source.variables, ...(project.variables ?? [])],
            ]),
          ),
          contentVersion: options.contentVersion ?? 'project-build',
          translations: localizationTranslationsForStory(options.localization, story.source.id),
          sourceLocale: options.localization?.sourceLocale ?? options.sourceLocale,
          localeFallbacks: options.localization
            ? Object.fromEntries(
                options.localization.locales.flatMap((locale: StoryLocalizationDocument['locales'][number]) =>
                  locale.fallback ? [[locale.locale, locale.fallback]] : [],
                ),
              )
            : options.localeFallbacks,
        },
      );
      diagnostics.push(
        ...compiled.diagnostics.map((diagnostic) => {
          const sourceChapterId = diagnostic.sourceNodeId
            ? story.source.chapters.find((chapter) =>
                chapter.graph.nodes.some((node) => node.id === diagnostic.sourceNodeId),
              )?.id
            : undefined;
          return {
            ...diagnostic,
            storyId: story.source.id,
            storyPath: story.path,
            storyName: story.source.displayName,
            sourceChapterId,
          };
        }),
      );
      if (compiled.ok) {
        programs[story.source.id] = {
          storyId: story.source.id,
          name: story.source.name,
          displayName: story.source.displayName,
          program: compiled.program,
          characters: story.source.characters,
          assets: story.source.assets,
        };
      }
    }
    if (!entryStoryId || diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      return { ok: false, diagnostics };
    }
    const contentVersion =
      options.contentVersion ??
      contentHash(
        JSON.stringify([
          project.events,
          project.signals,
          project.variables ?? [],
          options.localization ?? null,
          stories.map((story) => [story.path, story.source]),
        ]),
      );
    for (const compiled of Object.values(programs)) {
      compiled.program = { ...compiled.program, contentVersion };
    }
    return {
      ok: true,
      project: {
        format: STORY_COMPILED_PROJECT_FORMAT,
        version: STORY_COMPILED_PROJECT_VERSION,
        projectId: project.id,
        name: project.name,
        displayName: project.displayName,
        contentVersion,
        entryStoryId,
        events: project.events,
        signals: project.signals,
        stories: programs,
      },
      diagnostics,
    };
  }
}

export function compileProject(
  project: StoryProjectDocument,
  stories: readonly ProjectStorySource[],
  options?: CompileProjectOptions,
): CompileProjectResult {
  return new DefaultProjectCompiler().compile(project, stories, options);
}
