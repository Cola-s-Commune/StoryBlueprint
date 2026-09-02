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
  type StoryProjectDocument,
  type StoryId,
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

  const graphNodes: GraphNodeLike[] = graph.nodes.map((node) => ({
    id: node.id,
    type: node.type as StoryNodeType,
    data: node.data as GraphNodeLike['data'],
  }));
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
        type === StoryNodeType.Choice ||
        type === StoryNodeType.WaitSignal
      );
    });
    if (cyclic && !hasPause) {
      diagnostics.push(
        decorate({
          code: 'TIGHT_LOOP',
          severity: 'error',
          message: 'Execution cycle has no dialogue or choice pause point',
          sourceNodeId: component[0] as SourceNode['id'],
        }),
      );
    }
  };
  for (const nodeId of reachable) if (!indices.has(nodeId)) strongConnect(nodeId);
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
      const compiled = compileStory(
        {
          ...story.source,
          variables: [...story.source.variables, ...(project.variables ?? [])],
          events: project.events,
          signals: project.signals,
        },
        {
          ...options,
          availableStoryIds: project.stories.map((candidate) => candidate.id),
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
                options.localization.locales.flatMap((locale) =>
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
