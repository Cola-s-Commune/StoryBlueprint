import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { mkdir, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { is } from '@electron-toolkit/utils';
import {
  createStableId,
  parseStoryProject,
  parseStorySource,
  parseCharacterResource,
  parseAssetResource,
  serializeStoryProject,
  serializeStorySource,
  serializeCharacterResource,
  serializeAssetResource,
  STORY_PROJECT_FORMAT,
  STORY_PROJECT_VERSION,
  STORY_SOURCE_FORMAT,
  STORY_SOURCE_VERSION,
  STORY_COMPILED_PROJECT_FORMAT,
  STORY_COMPILED_PROJECT_VERSION,
  StoryNodeType,
  type AssetSource,
  type CharacterSource,
  type DialogueNodeData,
  type ProjectAssetReference,
  type ProjectCharacterReference,
  type StoryProjectDocument,
  type StorySourceDocument,
} from '@story-blueprint/common';
import type {
  CreateWorkspaceProjectRequest,
  CreateWorkspaceStoryRequest,
  EditorSessionState,
  RecoverySnapshot,
  SaveStoryRequest,
  UpdateProjectSettingsRequest,
  RecentProject,
  WorkspaceEntry,
  WorkspaceInfo,
} from '../shared/electronApi';

let mainWindow: BrowserWindow | null = null;
let storyDirty = false;
const storyFileTokens = new Map<string, Set<string>>();
let workspaceRoot: string | undefined;
let workspaceProjectFile: string | undefined;
let closeAfterSave = false;
let closeSavePending = false;

const MAX_STORY_BYTES = 64 * 1024 * 1024;
const MAX_WORKSPACE_ENTRIES = 10_000;
const MAX_WORKSPACE_DEPTH = 32;
const IGNORED_WORKSPACE_DIRECTORIES = new Set(['.git', 'node_modules']);
const MAX_RECENT_PROJECTS = 10;
const MAX_SESSION_STORIES = 50;
const MAX_RECOVERY_BYTES = 128 * 1024 * 1024;
const MAX_COMPILED_PROJECT_BYTES = 128 * 1024 * 1024;

function recentProjectsFile(): string {
  return join(app.getPath('userData'), 'recent-projects.json');
}

function editorSessionFile(): string {
  return join(app.getPath('userData'), 'editor-session.json');
}

function recoverySnapshotsFile(): string {
  return join(app.getPath('userData'), 'story-recovery.json');
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function isEditorSessionState(value: unknown): value is EditorSessionState {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Partial<EditorSessionState>;
  return (
    Array.isArray(session.storyFilePaths) &&
    session.storyFilePaths.length <= MAX_SESSION_STORIES &&
    session.storyFilePaths.every((filePath) => typeof filePath === 'string') &&
    (session.workspaceRoot === undefined || typeof session.workspaceRoot === 'string') &&
    (session.activeStoryFilePath === undefined || typeof session.activeStoryFilePath === 'string')
  );
}

function isRecoverySnapshot(value: unknown): value is RecoverySnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<RecoverySnapshot>;
  return (
    typeof snapshot.storyId === 'string' &&
    typeof snapshot.displayName === 'string' &&
    (snapshot.filePath === undefined || typeof snapshot.filePath === 'string') &&
    typeof snapshot.content === 'string' &&
    typeof snapshot.savedAt === 'string'
  );
}

async function writeUserDataJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readRecoverySnapshots(): Promise<RecoverySnapshot[]> {
  const value = await readJsonFile(recoverySnapshotsFile());
  return Array.isArray(value) ? value.filter(isRecoverySnapshot).slice(0, MAX_SESSION_STORIES) : [];
}

async function clearRecoverySnapshots(): Promise<void> {
  await writeUserDataJson(recoverySnapshotsFile(), []);
}

async function readRecentProjects(): Promise<RecentProject[]> {
  try {
    const value: unknown = JSON.parse(await readFile(recentProjectsFile(), 'utf8'));
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is RecentProject =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.name === 'string' &&
        typeof item.filePath === 'string' &&
        typeof item.lastOpenedAt === 'string',
    );
  } catch {
    return [];
  }
}

async function writeRecentProjects(projects: RecentProject[]): Promise<void> {
  await writeUserDataJson(recentProjectsFile(), projects);
}

async function rememberProject(filePath: string): Promise<void> {
  const resolvedPath = resolve(filePath);
  let name = basename(resolvedPath, extname(resolvedPath));
  try {
    name = parseStoryProject(await readFile(resolvedPath, 'utf8')).displayName;
  } catch {
    // The project parser will surface invalid files when the workspace is read.
  }
  const recent = (await readRecentProjects()).filter(
    (item) => item.filePath.toLowerCase() !== resolvedPath.toLowerCase(),
  );
  await writeRecentProjects(
    [{ name, filePath: resolvedPath, lastOpenedAt: new Date().toISOString() }, ...recent].slice(
      0,
      MAX_RECENT_PROJECTS,
    ),
  );
}

function ensureStoryExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith('.story') ? filePath : `${filePath}.story`;
}

function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return mainWindow !== null && event.sender === mainWindow.webContents;
}

function isSaveStoryRequest(value: unknown): value is SaveStoryRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Partial<SaveStoryRequest>;
  return (
    typeof request.content === 'string' &&
    Buffer.byteLength(request.content, 'utf8') <= MAX_STORY_BYTES &&
    (request.filePath === undefined || typeof request.filePath === 'string') &&
    (request.fileToken === undefined || typeof request.fileToken === 'string') &&
    (request.saveAs === undefined || typeof request.saveAs === 'boolean')
  );
}

function isSafeEntryName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return false;
  if (value === '.' || value === '..' || /[. ]$/.test(value) || /[<>:"/\\|?*]/.test(value)) {
    return false;
  }
  if ([...value].some((character) => character.charCodeAt(0) < 32)) return false;
  const windowsStem = value.split('.')[0].toUpperCase();
  return !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(windowsStem);
}

function resolveWorkspacePath(relativePath: string): string {
  if (!workspaceRoot) throw new Error('Open a workspace folder first');
  if (typeof relativePath !== 'string' || isAbsolute(relativePath)) {
    throw new Error('Invalid workspace path');
  }
  const target = resolve(workspaceRoot, relativePath);
  const fromRoot = relative(workspaceRoot, target);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('Path leaves workspace');
  }
  return target;
}

function ensureWithinWorkspace(target: string): string {
  if (!workspaceRoot) throw new Error('Open a workspace folder first');
  const fromRoot = relative(workspaceRoot, target);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('Path leaves workspace');
  }
  return target;
}

async function resolveExistingWorkspacePath(relativePath: string): Promise<string> {
  return ensureWithinWorkspace(await realpath(resolveWorkspacePath(relativePath)));
}

function toWorkspaceRelative(filePath: string): string {
  if (!workspaceRoot) return '';
  return relative(workspaceRoot, filePath).split('\\').join('/');
}

async function scanWorkspaceDirectory(
  directoryPath: string,
  depth: number,
  budget: { count: number },
): Promise<WorkspaceEntry[]> {
  if (depth > MAX_WORKSPACE_DEPTH) return [];
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const result: WorkspaceEntry[] = [];
  for (const entry of entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
    return left.name.localeCompare(right.name);
  })) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_WORKSPACE_DIRECTORIES.has(entry.name)) continue;
      if (++budget.count > MAX_WORKSPACE_ENTRIES)
        throw new Error('Workspace contains too many entries');
      let children: WorkspaceEntry[] = [];
      try {
        children = await scanWorkspaceDirectory(entryPath, depth + 1, budget);
      } catch (error) {
        if (error instanceof Error && error.message === 'Workspace contains too many entries') {
          throw error;
        }
      }
      result.push({
        kind: 'directory',
        name: entry.name,
        relativePath: toWorkspaceRelative(entryPath),
        children,
      });
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.story')) {
      if (++budget.count > MAX_WORKSPACE_ENTRIES)
        throw new Error('Workspace contains too many entries');
      result.push({
        kind: 'story',
        name: entry.name,
        relativePath: toWorkspaceRelative(entryPath),
      });
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.storyproject')) {
      if (++budget.count > MAX_WORKSPACE_ENTRIES)
        throw new Error('Workspace contains too many entries');
      result.push({
        kind: 'project',
        name: entry.name,
        relativePath: toWorkspaceRelative(entryPath),
      });
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.character')) {
      if (++budget.count > MAX_WORKSPACE_ENTRIES)
        throw new Error('Workspace contains too many entries');
      result.push({
        kind: 'character',
        name: entry.name,
        relativePath: toWorkspaceRelative(entryPath),
      });
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.asset')) {
      if (++budget.count > MAX_WORKSPACE_ENTRIES)
        throw new Error('Workspace contains too many entries');
      result.push({
        kind: 'asset',
        name: entry.name,
        relativePath: toWorkspaceRelative(entryPath),
      });
    }
  }
  return result;
}

async function readWorkspace(): Promise<WorkspaceInfo | undefined> {
  if (!workspaceRoot) return undefined;
  const entries = await scanWorkspaceDirectory(workspaceRoot, 0, { count: 0 });
  let project: StoryProjectDocument | undefined;
  let projectError: string | undefined;
  if (workspaceProjectFile) {
    try {
      project = parseStoryProject(await readFile(workspaceProjectFile, 'utf8'));
    } catch (error) {
      projectError = error instanceof Error ? error.message : String(error);
    }
  }
  const characterResources: WorkspaceInfo['characterResources'] = [];
  const assetResources: WorkspaceInfo['assetResources'] = [];
  const resourceErrors: WorkspaceInfo['resourceErrors'] = [];
  for (const entry of collectEntries(entries, 'character')) {
    try {
      characterResources.push({
        relativePath: entry.relativePath,
        character: parseCharacterResource(
          await readFile(resolveWorkspacePath(entry.relativePath), 'utf8'),
        ),
      });
    } catch (error) {
      resourceErrors.push({
        relativePath: entry.relativePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  for (const entry of collectEntries(entries, 'asset')) {
    try {
      assetResources.push({
        relativePath: entry.relativePath,
        asset: parseAssetResource(await readFile(resolveWorkspacePath(entry.relativePath), 'utf8')),
      });
    } catch (error) {
      resourceErrors.push({
        relativePath: entry.relativePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    name: basename(workspaceRoot),
    rootPath: workspaceRoot,
    entries,
    project,
    projectError,
    characterResources,
    assetResources,
    resourceErrors,
  };
}

function stableLocaleMap(locales: Readonly<Record<string, string>>): string {
  return JSON.stringify(
    Object.entries(locales).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function collectStoryEntries(entries: readonly WorkspaceEntry[]): WorkspaceEntry[] {
  return entries.flatMap((entry) =>
    entry.kind === 'story'
      ? [entry]
      : entry.kind === 'directory'
        ? collectStoryEntries(entry.children ?? [])
        : [],
  );
}

function collectEntries(
  entries: readonly WorkspaceEntry[],
  kind: WorkspaceEntry['kind'],
): WorkspaceEntry[] {
  return entries.flatMap((entry) =>
    entry.kind === kind
      ? [entry]
      : entry.kind === 'directory'
        ? collectEntries(entry.children ?? [], kind)
        : [],
  );
}

async function syncWorkspaceProject(): Promise<WorkspaceInfo> {
  if (!workspaceProjectFile) throw new Error('Create a .storyproject file first');
  const current = parseStoryProject(await readFile(workspaceProjectFile, 'utf8'));
  const entries = await scanWorkspaceDirectory(workspaceRoot!, 0, { count: 0 });
  const storyEntries = collectStoryEntries(entries);
  const stories: StoryProjectDocument['stories'][number][] = [];
  const characters = new Map<string, ProjectCharacterReference & { storyIds: string[] }>();
  const assets = new Map<string, ProjectAssetReference & { storyIds: string[] }>();

  for (const entry of collectEntries(entries, 'character')) {
    const character = parseCharacterResource(
      await readFile(resolveWorkspacePath(entry.relativePath), 'utf8'),
    );
    if (characters.has(character.id)) throw new Error(`Duplicate character ID ${character.id}`);
    characters.set(character.id, {
      id: character.id,
      name: character.name,
      displayName: character.displayName,
      path: entry.relativePath,
      storyIds: [],
    });
  }
  for (const entry of collectEntries(entries, 'asset')) {
    const asset = parseAssetResource(
      await readFile(resolveWorkspacePath(entry.relativePath), 'utf8'),
    );
    if (assets.has(asset.id)) throw new Error(`Duplicate asset ID ${asset.id}`);
    assets.set(asset.id, {
      id: asset.id,
      name: asset.name,
      displayName: asset.displayName,
      kind: asset.kind,
      path: entry.relativePath,
      locales: asset.locales ?? {},
      storyIds: [],
    });
  }

  const addUsage = (reference: { storyIds: string[] }, storyId: string) => {
    if (!reference.storyIds.includes(storyId)) reference.storyIds.push(storyId);
  };

  for (const entry of storyEntries) {
    const source = parseStorySource(
      await readFile(resolveWorkspacePath(entry.relativePath), 'utf8'),
    );
    stories.push({
      id: source.id,
      path: entry.relativePath,
      name: source.name,
      displayName: source.displayName,
    });
    for (const character of source.characters) {
      const existing = characters.get(character.id);
      if (existing) {
        if (
          existing.name !== character.name ||
          existing.displayName !== character.displayName ||
          existing.path
        ) {
          throw new Error(`Character ${character.id} has conflicting definitions`);
        }
        addUsage(existing, source.id);
      } else {
        characters.set(character.id, {
          id: character.id,
          name: character.name,
          displayName: character.displayName,
          storyIds: [source.id],
        });
      }
    }
    for (const asset of source.assets) {
      const existing = assets.get(asset.id);
      if (existing) {
        if (
          existing.name !== asset.name ||
          existing.displayName !== asset.displayName ||
          existing.kind !== asset.kind ||
          stableLocaleMap(existing.locales) !== stableLocaleMap(asset.locales ?? {}) ||
          Boolean(existing.path)
        ) {
          throw new Error(`Asset ${asset.id} has conflicting definitions`);
        }
        addUsage(existing, source.id);
      } else {
        assets.set(asset.id, {
          id: asset.id,
          name: asset.name,
          displayName: asset.displayName,
          kind: asset.kind,
          locales: asset.locales ?? {},
          storyIds: [source.id],
        });
      }
    }
    const graphNodes = [
      ...source.root.nodes,
      ...source.chapters.flatMap((chapter) => chapter.graph.nodes),
    ];
    for (const node of graphNodes) {
      if (node.type !== StoryNodeType.Dialogue) continue;
      const data = node.data as unknown as DialogueNodeData;
      const speakerIds = new Set(data.lines.map((line) => line.speakerId).filter(Boolean));
      const voiceIds = new Set(data.lines.map((line) => line.voiceId).filter(Boolean));
      for (const speakerId of speakerIds) {
        const character = characters.get(speakerId!);
        if (!character) throw new Error(`Dialogue references missing character ${speakerId}`);
        addUsage(character, source.id);
      }
      for (const voiceId of voiceIds) {
        const asset = assets.get(voiceId!);
        if (!asset) throw new Error(`Dialogue references missing asset ${voiceId}`);
        addUsage(asset, source.id);
      }
    }
  }

  const externalCharacters = new Map(
    await Promise.all(
      collectEntries(entries, 'character').map(
        async (entry) =>
          [
            entry.relativePath,
            parseCharacterResource(
              await readFile(resolveWorkspacePath(entry.relativePath), 'utf8'),
            ),
          ] as const,
      ),
    ),
  );
  for (const reference of characters.values()) {
    if (!reference.path) continue;
    const character = externalCharacters.get(reference.path);
    if (!character) continue;
    const portraitIds = [
      character.defaultPortraitId,
      ...Object.values(character.emotions).map((emotion) => emotion.portraitId),
    ].filter((id): id is NonNullable<typeof id> => Boolean(id));
    for (const portraitId of portraitIds) {
      const asset = assets.get(portraitId);
      if (!asset || asset.kind !== 'portrait') {
        throw new Error(`Character ${character.id} references invalid portrait ${portraitId}`);
      }
      for (const storyId of reference.storyIds) addUsage(asset, storyId);
    }
  }

  const next: StoryProjectDocument = {
    ...current,
    entryStoryId:
      current.entryStoryId && stories.some((story) => story.id === current.entryStoryId)
        ? current.entryStoryId
        : stories[0]?.id,
    stories,
    characters: [...characters.values()] as ProjectCharacterReference[],
    assets: [...assets.values()] as ProjectAssetReference[],
  };
  await writeFile(workspaceProjectFile, serializeStoryProject(next), 'utf8');
  return (await readWorkspace())!;
}

async function validateCharacterResourceWrite(
  character: CharacterSource,
  relativePath?: string,
): Promise<void> {
  if (!workspaceProjectFile) throw new Error('Open a project first');
  const project = parseStoryProject(await readFile(workspaceProjectFile, 'utf8'));
  const conflict = project.characters.find(
    (candidate) =>
      candidate.path !== relativePath &&
      (candidate.id === character.id || candidate.name === character.name),
  );
  if (conflict) throw new Error(`Character conflicts with ${conflict.displayName}`);
  const portraitIds = [
    character.defaultPortraitId,
    ...Object.values(character.emotions).map((emotion) => emotion.portraitId),
  ].filter(Boolean);
  for (const portraitId of portraitIds) {
    if (!project.assets.some((asset) => asset.id === portraitId && asset.kind === 'portrait')) {
      throw new Error(`Character references missing portrait ${portraitId}`);
    }
  }
}

async function validateAssetResourceWrite(
  asset: AssetSource,
  relativePath?: string,
): Promise<void> {
  if (!workspaceProjectFile) throw new Error('Open a project first');
  const project = parseStoryProject(await readFile(workspaceProjectFile, 'utf8'));
  const conflict = project.assets.find(
    (candidate) =>
      candidate.path !== relativePath &&
      (candidate.id === asset.id || candidate.name === asset.name),
  );
  if (conflict) throw new Error(`Asset conflicts with ${conflict.displayName}`);
  if (asset.kind !== 'portrait') {
    const workspace = await readWorkspace();
    const referenced = workspace?.characterResources.some(({ character }) =>
      [
        character.defaultPortraitId,
        ...Object.values(character.emotions).map((emotion) => emotion.portraitId),
      ].includes(asset.id),
    );
    if (referenced) throw new Error('Asset is used as a character portrait');
  }
}

async function openStoryFile(filePath: string) {
  const content = await readFile(filePath, 'utf8');
  const fileToken = randomUUID();
  const tokens = storyFileTokens.get(filePath) ?? new Set<string>();
  tokens.add(fileToken);
  storyFileTokens.set(filePath, tokens);
  return { canceled: false as const, filePath, fileToken, content };
}

async function createInitialStoryFile(rootPath: string): Promise<{
  source: StorySourceDocument;
  opened: Exclude<Awaited<ReturnType<typeof openStoryFile>>, { canceled: true }>;
}> {
  const source: StorySourceDocument = {
    format: STORY_SOURCE_FORMAT,
    version: STORY_SOURCE_VERSION,
    id: createStableId('story'),
    name: 'main',
    displayName: 'Main Story',
    root: {
      nodes: [
        {
          id: createStableId('node'),
          type: StoryNodeType.Start,
          definitionVersion: 1,
          position: { x: 160, y: 120 },
          data: { title: 'Story Entry' },
        },
      ],
      edges: [],
    },
    chapters: [],
    variables: [],
    characters: [],
    assets: [],
    events: [],
  };
  for (let index = 1; index <= MAX_WORKSPACE_ENTRIES; index += 1) {
    const fileName = index === 1 ? 'main.story' : `main-${index}.story`;
    source.name = index === 1 ? 'main' : `main-${index}`;
    source.displayName = index === 1 ? 'Main Story' : `Main Story ${index}`;
    const filePath = join(rootPath, fileName);
    try {
      await writeFile(filePath, serializeStorySource(source), { encoding: 'utf8', flag: 'wx' });
      return { source, opened: await openStoryFile(filePath) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Cannot allocate a file name for the initial Story');
}

function requireAuthorizedStoryFile(filePath: unknown, fileToken: unknown): string {
  if (
    typeof filePath !== 'string' ||
    typeof fileToken !== 'string' ||
    !storyFileTokens.get(filePath)?.has(fileToken) ||
    !filePath.toLowerCase().endsWith('.story')
  ) {
    throw new Error('Story file is not authorized');
  }
  return filePath;
}

function isPathInsideWorkspace(filePath: string): boolean {
  if (!workspaceRoot) return false;
  const fromRoot = relative(workspaceRoot, filePath);
  return (
    fromRoot === '' ||
    (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`))
  );
}

async function activateWorkspace(rootPath: string, projectFile?: string): Promise<WorkspaceInfo> {
  workspaceRoot = await realpath(resolve(rootPath));
  if (projectFile) {
    workspaceProjectFile = ensureWithinWorkspace(await realpath(projectFile));
  } else {
    const rootEntries = await readdir(workspaceRoot, { withFileTypes: true });
    const projectFiles = rootEntries.filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.storyproject'),
    );
    if (projectFiles.length > 1) throw new Error('Workspace root contains multiple project files');
    workspaceProjectFile = projectFiles[0] ? join(workspaceRoot, projectFiles[0].name) : undefined;
  }
  if (workspaceProjectFile) await rememberProject(workspaceProjectFile);
  return (await readWorkspace())!;
}

function registerStoryFileHandlers(): void {
  ipcMain.handle('clipboard:write-text', async (event, text: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    if (typeof text !== 'string') throw new Error('Invalid clipboard text');
    clipboard.writeText(text);
  });
  ipcMain.handle('clipboard:read-text', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return clipboard.readText();
  });

  ipcMain.on('story:set-dirty', (event, dirty: unknown) => {
    if (!isTrustedSender(event) || typeof dirty !== 'boolean') return;
    storyDirty = dirty === true;
  });
  ipcMain.handle('story:open', async (event) => {
    if (!isTrustedSender(event) || !mainWindow) throw new Error('Untrusted IPC sender');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Story',
      defaultPath: app.getPath('documents'),
      properties: ['openFile'],
      filters: [{ name: 'Story Blueprint', extensions: ['story'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    return openStoryFile(filePath);
  });

  ipcMain.handle('story:save', async (event, request: unknown) => {
    if (!isTrustedSender(event) || !mainWindow) throw new Error('Untrusted IPC sender');
    if (!isSaveStoryRequest(request)) throw new Error('Invalid story save request');

    let filePath =
      !request.saveAs &&
      request.filePath &&
      request.fileToken &&
      storyFileTokens.get(request.filePath)?.has(request.fileToken)
        ? request.filePath
        : undefined;
    if (!filePath) {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Story',
        defaultPath: request.filePath ?? join(app.getPath('documents'), 'untitled.story'),
        filters: [{ name: 'Story Blueprint', extensions: ['story'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      filePath = ensureStoryExtension(result.filePath);
    }
    await writeFile(filePath, request.content, 'utf8');
    const fileToken = randomUUID();
    const tokens = storyFileTokens.get(filePath) ?? new Set<string>();
    tokens.add(fileToken);
    storyFileTokens.set(filePath, tokens);
    return { canceled: false, filePath, fileToken };
  });

  ipcMain.handle('story:reveal', async (event, filePath: unknown, fileToken: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    shell.showItemInFolder(requireAuthorizedStoryFile(filePath, fileToken));
  });

  ipcMain.handle('story:delete', async (event, filePath: unknown, fileToken: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    const authorizedPath = requireAuthorizedStoryFile(filePath, fileToken);
    await unlink(authorizedPath);
    storyFileTokens.delete(authorizedPath);
    if (!isPathInsideWorkspace(authorizedPath)) return undefined;
    return workspaceProjectFile ? syncWorkspaceProject() : readWorkspace();
  });

  ipcMain.handle('workspace:open', async (event) => {
    if (!isTrustedSender(event) || !mainWindow) throw new Error('Untrusted IPC sender');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Story Workspace',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, workspace: await activateWorkspace(result.filePaths[0]) };
  });

  ipcMain.handle('workspace:open-project', async (event) => {
    if (!isTrustedSender(event) || !mainWindow) throw new Error('Untrusted IPC sender');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Story Project',
      defaultPath: app.getPath('documents'),
      properties: ['openFile'],
      filters: [{ name: 'Story Blueprint Project', extensions: ['storyproject'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const projectFile = result.filePaths[0];
    return {
      canceled: false,
      workspace: await activateWorkspace(dirname(projectFile), projectFile),
    };
  });

  ipcMain.handle('workspace:open-recent-project', async (event, filePath: unknown) => {
    if (!isTrustedSender(event) || typeof filePath !== 'string') {
      throw new Error('Invalid recent project request');
    }
    const projectFile = await realpath(filePath);
    if (!projectFile.toLowerCase().endsWith('.storyproject')) {
      throw new Error('Not a Story project file');
    }
    return {
      canceled: false,
      workspace: await activateWorkspace(dirname(projectFile), projectFile),
    };
  });

  ipcMain.handle('workspace:get-recent-projects', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return readRecentProjects();
  });

  ipcMain.handle('workspace:remove-recent-project', async (event, filePath: unknown) => {
    if (!isTrustedSender(event) || typeof filePath !== 'string') {
      throw new Error('Invalid recent project request');
    }
    const next = (await readRecentProjects()).filter(
      (item) => item.filePath.toLowerCase() !== filePath.toLowerCase(),
    );
    await writeRecentProjects(next);
    return next;
  });

  ipcMain.handle('story:confirm-unsaved', async (event, names: unknown, action: unknown) => {
    if (!isTrustedSender(event) || !mainWindow || !Array.isArray(names)) {
      throw new Error('Invalid unsaved stories request');
    }
    const storyNames = names.filter((name): name is string => typeof name === 'string');
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Unsaved Stories',
      message: `${storyNames.length === 1 ? storyNames[0] : `${storyNames.length} Stories`} has unsaved changes.`,
      detail: `Save your changes before ${typeof action === 'string' ? action : 'continuing'}?`,
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    return result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel';
  });

  ipcMain.handle('session:update', async (event, value: unknown) => {
    if (!isTrustedSender(event) || !isEditorSessionState(value)) {
      throw new Error('Invalid editor session');
    }
    await writeUserDataJson(editorSessionFile(), value);
  });

  ipcMain.handle('recovery:write', async (event, value: unknown) => {
    if (!isTrustedSender(event) || !Array.isArray(value) || value.length > MAX_SESSION_STORIES) {
      throw new Error('Invalid recovery snapshots');
    }
    const snapshots = value.filter(isRecoverySnapshot);
    if (
      snapshots.length !== value.length ||
      Buffer.byteLength(JSON.stringify(snapshots), 'utf8') > MAX_RECOVERY_BYTES
    ) {
      throw new Error('Invalid recovery snapshots');
    }
    for (const snapshot of snapshots) parseStorySource(snapshot.content);
    await writeUserDataJson(recoverySnapshotsFile(), snapshots);
  });

  ipcMain.handle('session:restore', async (event) => {
    if (!isTrustedSender(event) || !mainWindow) throw new Error('Untrusted IPC sender');
    const value = await readJsonFile(editorSessionFile());
    const session = isEditorSessionState(value)
      ? value
      : ({ storyFilePaths: [] } satisfies EditorSessionState);
    let restoredWorkspace: WorkspaceInfo | undefined;
    if (session.workspaceRoot) {
      try {
        restoredWorkspace = await activateWorkspace(session.workspaceRoot);
      } catch {
        workspaceRoot = undefined;
        workspaceProjectFile = undefined;
      }
    }
    const storyPaths = [...new Set(session.storyFilePaths)].sort((left, right) => {
      if (left === session.activeStoryFilePath) return 1;
      if (right === session.activeStoryFilePath) return -1;
      return 0;
    });
    const restoredStories: Exclude<
      Awaited<ReturnType<typeof openStoryFile>>,
      { canceled: true }
    >[] = [];
    for (const filePath of storyPaths) {
      try {
        const resolvedPath = await realpath(filePath);
        if (!resolvedPath.toLowerCase().endsWith('.story')) continue;
        restoredStories.push(await openStoryFile(resolvedPath));
      } catch {
        // Missing or inaccessible files are omitted from the restored session.
      }
    }
    let recoveries = await readRecoverySnapshots();
    if (recoveries.length > 0) {
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Recover Unsaved Stories',
        message: `Recover ${recoveries.length} unsaved ${recoveries.length === 1 ? 'Story' : 'Stories'}?`,
        detail: 'Story Blueprint saved recovery copies from the previous session.',
        buttons: ['Recover', 'Discard Recovery'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (result.response === 1) {
        await clearRecoverySnapshots();
        recoveries = [];
      }
    }
    return { workspace: restoredWorkspace, stories: restoredStories, recoveries };
  });

  ipcMain.on('app:finish-close', (event, saved: unknown) => {
    if (!isTrustedSender(event) || !closeSavePending) return;
    closeSavePending = false;
    if (saved !== true) return;
    storyDirty = false;
    closeAfterSave = true;
    void clearRecoverySnapshots().finally(() => mainWindow?.close());
  });

  ipcMain.handle('workspace:new-project', async (event) => {
    if (!isTrustedSender(event) || !mainWindow) throw new Error('Untrusted IPC sender');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'New Story Project',
      defaultPath: join(app.getPath('documents'), 'untitled.storyproject'),
      filters: [{ name: 'Story Blueprint Project', extensions: ['storyproject'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const projectFile = result.filePath.toLowerCase().endsWith('.storyproject')
      ? result.filePath
      : `${result.filePath}.storyproject`;
    const rootPath = dirname(projectFile);
    const rootEntries = await readdir(rootPath, { withFileTypes: true });
    const otherProject = rootEntries.find(
      (entry) =>
        entry.isFile() &&
        entry.name.toLowerCase().endsWith('.storyproject') &&
        join(rootPath, entry.name).toLowerCase() !== projectFile.toLowerCase(),
    );
    if (otherProject) throw new Error('Target folder already contains a Story project');
    const fileStem = basename(projectFile, extname(projectFile));
    const name =
      fileStem
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'project';
    const project: StoryProjectDocument = {
      format: STORY_PROJECT_FORMAT,
      version: STORY_PROJECT_VERSION,
      id: createStableId('project'),
      name,
      displayName: fileStem,
      stories: [],
      characters: [],
      assets: [],
    };
    await writeFile(projectFile, serializeStoryProject(project), 'utf8');
    const initialStory = await createInitialStoryFile(rootPath);
    await activateWorkspace(rootPath, projectFile);
    const synced = await syncWorkspaceProject();
    await writeFile(
      projectFile,
      serializeStoryProject({ ...synced.project!, entryStoryId: initialStory.source.id }),
      'utf8',
    );
    return {
      canceled: false,
      workspace: (await readWorkspace())!,
      initialStory: initialStory.opened,
    };
  });

  ipcMain.handle('workspace:refresh', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return readWorkspace();
  });

  ipcMain.handle('workspace:reveal-item', async (event, relativePath: unknown) => {
    if (!isTrustedSender(event) || typeof relativePath !== 'string') {
      throw new Error('Invalid workspace item request');
    }
    shell.showItemInFolder(await resolveExistingWorkspacePath(relativePath));
  });

  ipcMain.handle('workspace:delete-story', async (event, relativePath: unknown) => {
    if (!isTrustedSender(event) || typeof relativePath !== 'string') {
      throw new Error('Invalid workspace Story delete');
    }
    const filePath = await resolveExistingWorkspacePath(relativePath);
    if (!filePath.toLowerCase().endsWith('.story')) throw new Error('Not a Story file');
    await unlink(filePath);
    storyFileTokens.delete(filePath);
    return workspaceProjectFile ? syncWorkspaceProject() : (await readWorkspace())!;
  });

  ipcMain.handle('workspace:delete-project', async (event, relativePath: unknown) => {
    if (!isTrustedSender(event) || typeof relativePath !== 'string') {
      throw new Error('Invalid workspace project delete');
    }
    const filePath = await resolveExistingWorkspacePath(relativePath);
    if (!filePath.toLowerCase().endsWith('.storyproject')) throw new Error('Not a project file');
    await unlink(filePath);
    if (workspaceProjectFile && filePath.toLowerCase() === workspaceProjectFile.toLowerCase()) {
      workspaceProjectFile = undefined;
    }
    await writeRecentProjects(
      (await readRecentProjects()).filter(
        (project) => project.filePath.toLowerCase() !== filePath.toLowerCase(),
      ),
    );
    return (await readWorkspace())!;
  });

  ipcMain.handle('workspace:open-story', async (event, relativePath: unknown) => {
    if (!isTrustedSender(event) || typeof relativePath !== 'string') {
      throw new Error('Invalid workspace story request');
    }
    const filePath = await resolveExistingWorkspacePath(relativePath);
    if (!filePath.toLowerCase().endsWith('.story')) throw new Error('Not a Story file');
    return openStoryFile(filePath);
  });

  ipcMain.handle(
    'workspace:create-directory',
    async (event, parent: unknown, name: unknown): Promise<WorkspaceInfo> => {
      if (!isTrustedSender(event) || typeof parent !== 'string' || !isSafeEntryName(name)) {
        throw new Error('Invalid workspace directory request');
      }
      await mkdir(join(await resolveExistingWorkspacePath(parent), name));
      return (await readWorkspace())!;
    },
  );

  ipcMain.handle('workspace:create-story', async (event, request: unknown) => {
    const candidate = request as Partial<CreateWorkspaceStoryRequest>;
    if (
      !isTrustedSender(event) ||
      typeof candidate.directory !== 'string' ||
      !isSafeEntryName(candidate.name) ||
      typeof candidate.content !== 'string' ||
      Buffer.byteLength(candidate.content, 'utf8') > MAX_STORY_BYTES
    ) {
      throw new Error('Invalid workspace story request');
    }
    const fileName = ensureStoryExtension(candidate.name);
    const filePath = join(await resolveExistingWorkspacePath(candidate.directory), fileName);
    await writeFile(filePath, candidate.content, { encoding: 'utf8', flag: 'wx' });
    const result = await openStoryFile(filePath);
    if (workspaceProjectFile) await syncWorkspaceProject();
    return result;
  });

  ipcMain.handle('workspace:create-project', async (event, request: unknown) => {
    const candidate = request as Partial<CreateWorkspaceProjectRequest>;
    if (
      !isTrustedSender(event) ||
      workspaceProjectFile ||
      !isSafeEntryName(candidate.fileName) ||
      typeof candidate.content !== 'string' ||
      Buffer.byteLength(candidate.content, 'utf8') > MAX_STORY_BYTES
    ) {
      throw new Error('Invalid workspace project request');
    }
    parseStoryProject(candidate.content);
    const fileName = candidate.fileName.toLowerCase().endsWith('.storyproject')
      ? candidate.fileName
      : `${candidate.fileName}.storyproject`;
    workspaceProjectFile = join(workspaceRoot!, fileName);
    await writeFile(workspaceProjectFile, candidate.content, { encoding: 'utf8', flag: 'wx' });
    const initialStory = await createInitialStoryFile(workspaceRoot!);
    const synced = await syncWorkspaceProject();
    await writeFile(
      workspaceProjectFile,
      serializeStoryProject({ ...synced.project!, entryStoryId: initialStory.source.id }),
      'utf8',
    );
    return { workspace: (await readWorkspace())!, initialStory: initialStory.opened };
  });

  ipcMain.handle('workspace:sync-project', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return syncWorkspaceProject();
  });

  ipcMain.handle('workspace:read-project-stories', async (event) => {
    if (!isTrustedSender(event) || !workspaceProjectFile) {
      throw new Error('Open a Story project first');
    }
    const project = parseStoryProject(await readFile(workspaceProjectFile, 'utf8'));
    return Promise.all(
      project.stories.map(async (story) => {
        const filePath = await resolveExistingWorkspacePath(story.path);
        if (!filePath.toLowerCase().endsWith('.story')) throw new Error('Not a Story file');
        const content = await readFile(filePath, 'utf8');
        const source = parseStorySource(content);
        if (source.id !== story.id) {
          throw new Error(`Story ID does not match project index: ${story.path}`);
        }
        return { path: story.path, content };
      }),
    );
  });

  ipcMain.handle('workspace:update-project-settings', async (event, value: unknown) => {
    if (!isTrustedSender(event) || !workspaceProjectFile || typeof value !== 'object' || !value) {
      throw new Error('Invalid project settings');
    }
    const settings = value as Partial<UpdateProjectSettingsRequest>;
    if (
      (settings.entryStoryId !== undefined && typeof settings.entryStoryId !== 'string') ||
      (settings.outputDirectory !== undefined && typeof settings.outputDirectory !== 'string')
    ) {
      throw new Error('Invalid project settings');
    }
    const current = parseStoryProject(await readFile(workspaceProjectFile, 'utf8'));
    const next: StoryProjectDocument = {
      ...current,
      entryStoryId: settings.entryStoryId as StoryProjectDocument['entryStoryId'],
      outputDirectory: settings.outputDirectory?.trim() || undefined,
    };
    await writeFile(workspaceProjectFile, serializeStoryProject(next), 'utf8');
    return (await readWorkspace())!;
  });

  ipcMain.handle('workspace:create-character', async (event, value: unknown) => {
    if (!isTrustedSender(event) || !workspaceProjectFile) throw new Error('Open a project first');
    const character = value as CharacterSource;
    const content = serializeCharacterResource(character);
    await validateCharacterResourceWrite(character);
    const directory = resolveWorkspacePath('Characters');
    await mkdir(directory, { recursive: true });
    const filePath = join(directory, `${character.name}-${character.id.slice(-6)}.character`);
    await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
    return syncWorkspaceProject();
  });

  ipcMain.handle(
    'workspace:update-character',
    async (event, relativePath: unknown, value: unknown) => {
      if (!isTrustedSender(event) || typeof relativePath !== 'string') {
        throw new Error('Invalid character update');
      }
      const filePath = await resolveExistingWorkspacePath(relativePath);
      if (!filePath.toLowerCase().endsWith('.character')) throw new Error('Not a character file');
      const previous = parseCharacterResource(await readFile(filePath, 'utf8'));
      const character = value as CharacterSource;
      if (character.id !== previous.id) throw new Error('Character ID cannot be changed');
      await validateCharacterResourceWrite(character, relativePath);
      await writeFile(filePath, serializeCharacterResource(character), 'utf8');
      return syncWorkspaceProject();
    },
  );

  ipcMain.handle('workspace:delete-character', async (event, relativePath: unknown) => {
    if (
      !isTrustedSender(event) ||
      !mainWindow ||
      typeof relativePath !== 'string' ||
      !workspaceProjectFile
    ) {
      throw new Error('Invalid character delete');
    }
    const project = parseStoryProject(await readFile(workspaceProjectFile, 'utf8'));
    const reference = project.characters.find((character) => character.path === relativePath);
    if (reference?.storyIds.length) {
      throw new Error(`Character is used by ${reference.storyIds.length} Story file(s)`);
    }
    const filePath = await resolveExistingWorkspacePath(relativePath);
    if (!filePath.toLowerCase().endsWith('.character')) throw new Error('Not a character file');
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Delete Character',
      message: `Delete character "${reference?.displayName ?? basename(filePath, extname(filePath))}"?`,
      detail: 'The character file will be permanently deleted. This cannot be undone.',
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) {
      return { canceled: true, workspace: (await readWorkspace())! };
    }
    await unlink(filePath);
    return { canceled: false, workspace: await syncWorkspaceProject() };
  });

  ipcMain.handle('workspace:create-asset', async (event, value: unknown) => {
    if (!isTrustedSender(event) || !workspaceProjectFile) throw new Error('Open a project first');
    const asset = value as AssetSource;
    const content = serializeAssetResource(asset);
    await validateAssetResourceWrite(asset);
    const directory = resolveWorkspacePath('Assets');
    await mkdir(directory, { recursive: true });
    const filePath = join(directory, `${asset.name}-${asset.id.slice(-6)}.asset`);
    await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
    return syncWorkspaceProject();
  });

  ipcMain.handle('workspace:update-asset', async (event, relativePath: unknown, value: unknown) => {
    if (!isTrustedSender(event) || typeof relativePath !== 'string') {
      throw new Error('Invalid asset update');
    }
    const filePath = await resolveExistingWorkspacePath(relativePath);
    if (!filePath.toLowerCase().endsWith('.asset')) throw new Error('Not an asset file');
    const previous = parseAssetResource(await readFile(filePath, 'utf8'));
    const asset = value as AssetSource;
    if (asset.id !== previous.id) throw new Error('Asset ID cannot be changed');
    await validateAssetResourceWrite(asset, relativePath);
    await writeFile(filePath, serializeAssetResource(asset), 'utf8');
    return syncWorkspaceProject();
  });

  ipcMain.handle('workspace:delete-asset', async (event, relativePath: unknown) => {
    if (!isTrustedSender(event) || typeof relativePath !== 'string' || !workspaceProjectFile) {
      throw new Error('Invalid asset delete');
    }
    const project = parseStoryProject(await readFile(workspaceProjectFile, 'utf8'));
    const reference = project.assets.find((asset) => asset.path === relativePath);
    if (reference?.storyIds.length) {
      throw new Error(`Asset is used by ${reference.storyIds.length} Story file(s)`);
    }
    const workspace = await readWorkspace();
    const character = reference
      ? workspace?.characterResources.find(({ character }) =>
          [
            character.defaultPortraitId,
            ...Object.values(character.emotions).map((emotion) => emotion.portraitId),
          ].includes(reference.id),
        )
      : undefined;
    if (character) throw new Error(`Asset is used by character ${character.character.displayName}`);
    const filePath = await resolveExistingWorkspacePath(relativePath);
    if (!filePath.toLowerCase().endsWith('.asset')) throw new Error('Not an asset file');
    await unlink(filePath);
    return syncWorkspaceProject();
  });

  ipcMain.handle('workspace:export-compiled', async (event, content: unknown) => {
    if (
      !isTrustedSender(event) ||
      !mainWindow ||
      !workspaceProjectFile ||
      typeof content !== 'string' ||
      Buffer.byteLength(content, 'utf8') > MAX_COMPILED_PROJECT_BYTES
    ) {
      throw new Error('Invalid compiled project export');
    }
    const value: unknown = JSON.parse(content);
    if (
      typeof value !== 'object' ||
      value === null ||
      (value as { format?: unknown }).format !== STORY_COMPILED_PROJECT_FORMAT ||
      (value as { version?: unknown }).version !== STORY_COMPILED_PROJECT_VERSION
    ) {
      throw new Error('Unsupported compiled project format');
    }
    const project = parseStoryProject(await readFile(workspaceProjectFile, 'utf8'));
    if (project.outputDirectory) {
      const outputDirectory = await resolveExistingWorkspacePath(project.outputDirectory);
      const filePath = join(outputDirectory, `${project.name}.storyc.json`);
      await writeFile(filePath, content, 'utf8');
      return { canceled: false, filePath };
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Compiled Story Project',
      defaultPath: join(workspaceRoot ?? app.getPath('documents'), `${project.name}.storyc.json`),
      filters: [{ name: 'Compiled Story Project', extensions: ['storyc.json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = result.filePath.toLowerCase().endsWith('.storyc.json')
      ? result.filePath
      : `${result.filePath}.storyc.json`;
    await writeFile(filePath, content, 'utf8');
    return { canceled: false, filePath };
  });

  ipcMain.handle('workspace:open-compiled', async (event) => {
    if (!isTrustedSender(event) || !mainWindow) throw new Error('Untrusted IPC sender');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Compiled Story Project',
      defaultPath: workspaceRoot ?? app.getPath('documents'),
      properties: ['openFile'],
      filters: [{ name: 'Compiled Story Project', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    if (!filePath.toLowerCase().endsWith('.storyc.json')) {
      throw new Error('Choose a .storyc.json file');
    }
    const content = await readFile(filePath, 'utf8');
    if (Buffer.byteLength(content, 'utf8') > MAX_COMPILED_PROJECT_BYTES) {
      throw new Error('Compiled project is too large');
    }
    const value: unknown = JSON.parse(content);
    if (
      typeof value !== 'object' ||
      value === null ||
      (value as { format?: unknown }).format !== STORY_COMPILED_PROJECT_FORMAT ||
      (value as { version?: unknown }).version !== STORY_COMPILED_PROJECT_VERSION
    ) {
      throw new Error('Unsupported compiled project format');
    }
    return { canceled: false, filePath, content };
  });
}

function createWindow(): void {
  closeAfterSave = false;
  closeSavePending = false;
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Story Blueprint',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', (event) => {
    if (!storyDirty || closeAfterSave) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      title: 'Unsaved Stories',
      message: 'Save unsaved story changes?',
      detail: 'One or more open stories contain edits that have not been saved.',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (choice === 0 && !closeSavePending) {
      closeSavePending = true;
      mainWindow?.webContents.send('app:save-before-close');
    } else if (choice === 1) {
      storyDirty = false;
      closeAfterSave = true;
      void clearRecoverySnapshots().finally(() => mainWindow?.close());
    }
  });
}

app.whenReady().then(() => {
  registerStoryFileHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('did-create-window', (childWindow) => {
    childWindow.setMenu(null);
    childWindow.setBackgroundColor('#1e1e1e');
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          minWidth: 320,
          minHeight: 240,
          backgroundColor: '#1e1e1e',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    return { action: 'deny' };
  });
});
