import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { is } from '@electron-toolkit/utils';
import {
  createStableId,
  parseStoryProject,
  parseStorySource,
  serializeStoryProject,
  STORY_PROJECT_FORMAT,
  STORY_PROJECT_VERSION,
  type ProjectAssetReference,
  type ProjectCharacterReference,
  type StoryProjectDocument,
} from '@story-blueprint/common';
import type {
  CreateWorkspaceProjectRequest,
  CreateWorkspaceStoryRequest,
  SaveStoryRequest,
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

function recentProjectsFile(): string {
  return join(app.getPath('userData'), 'recent-projects.json');
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
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(recentProjectsFile(), `${JSON.stringify(projects, null, 2)}\n`, 'utf8');
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
  await writeRecentProjects([
    { name, filePath: resolvedPath, lastOpenedAt: new Date().toISOString() },
    ...recent,
  ].slice(0, MAX_RECENT_PROJECTS));
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
    }
  }
  return result;
}

async function readWorkspace(): Promise<WorkspaceInfo | undefined> {
  if (!workspaceRoot) return undefined;
  let project: StoryProjectDocument | undefined;
  let projectError: string | undefined;
  if (workspaceProjectFile) {
    try {
      project = parseStoryProject(await readFile(workspaceProjectFile, 'utf8'));
    } catch (error) {
      projectError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    name: basename(workspaceRoot),
    rootPath: workspaceRoot,
    entries: await scanWorkspaceDirectory(workspaceRoot, 0, { count: 0 }),
    project,
    projectError,
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

async function syncWorkspaceProject(): Promise<WorkspaceInfo> {
  if (!workspaceProjectFile) throw new Error('Create a .storyproject file first');
  const current = parseStoryProject(await readFile(workspaceProjectFile, 'utf8'));
  const entries = await scanWorkspaceDirectory(workspaceRoot!, 0, { count: 0 });
  const storyEntries = collectStoryEntries(entries);
  const stories: StoryProjectDocument['stories'][number][] = [];
  const characters = new Map<string, ProjectCharacterReference & { storyIds: string[] }>();
  const assets = new Map<string, ProjectAssetReference & { storyIds: string[] }>();

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
        if (existing.name !== character.name || existing.displayName !== character.displayName) {
          throw new Error(`Character ${character.id} has conflicting definitions`);
        }
        existing.storyIds.push(source.id);
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
          stableLocaleMap(existing.locales) !== stableLocaleMap(asset.locales ?? {})
        ) {
          throw new Error(`Asset ${asset.id} has conflicting definitions`);
        }
        existing.storyIds.push(source.id);
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
  }

  const next: StoryProjectDocument = {
    ...current,
    stories,
    characters: [...characters.values()] as ProjectCharacterReference[],
    assets: [...assets.values()] as ProjectAssetReference[],
  };
  await writeFile(workspaceProjectFile, serializeStoryProject(next), 'utf8');
  return (await readWorkspace())!;
}

async function openStoryFile(filePath: string) {
  const content = await readFile(filePath, 'utf8');
  const fileToken = randomUUID();
  const tokens = storyFileTokens.get(filePath) ?? new Set<string>();
  tokens.add(fileToken);
  storyFileTokens.set(filePath, tokens);
  return { canceled: false as const, filePath, fileToken, content };
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

  ipcMain.on('app:finish-close', (event, saved: unknown) => {
    if (!isTrustedSender(event) || !closeSavePending) return;
    closeSavePending = false;
    if (saved !== true) return;
    storyDirty = false;
    closeAfterSave = true;
    mainWindow?.close();
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
    await activateWorkspace(rootPath, projectFile);
    return { canceled: false, workspace: await syncWorkspaceProject() };
  });

  ipcMain.handle('workspace:refresh', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return readWorkspace();
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
    return syncWorkspaceProject();
  });

  ipcMain.handle('workspace:sync-project', async (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return syncWorkspaceProject();
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
      mainWindow?.close();
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
