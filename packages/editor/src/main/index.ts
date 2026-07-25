import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { is } from '@electron-toolkit/utils';
import type { SaveStoryRequest } from '../shared/electronApi';

let mainWindow: BrowserWindow | null = null;
let storyDirty = false;
const storyFileTokens = new Map<string, Set<string>>();

const MAX_STORY_BYTES = 64 * 1024 * 1024;

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

function registerStoryFileHandlers(): void {
  ipcMain.on('story:set-dirty', (event, dirty: unknown) => {
    if (!isTrustedSender(event) || typeof dirty !== 'boolean') return;
    storyDirty = dirty === true;
  });
  ipcMain.handle('story:open', async (event) => {
    if (!isTrustedSender(event) || !mainWindow) throw new Error('Untrusted IPC sender');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Story',
      properties: ['openFile'],
      filters: [{ name: 'Story Blueprint', extensions: ['story'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    const content = await readFile(filePath, 'utf8');
    const fileToken = randomUUID();
    const tokens = storyFileTokens.get(filePath) ?? new Set<string>();
    tokens.add(fileToken);
    storyFileTokens.set(filePath, tokens);
    return { canceled: false, filePath, fileToken, content };
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
        defaultPath: request.filePath ?? 'untitled.story',
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
}

function createWindow(): void {
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
    if (!storyDirty) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      title: 'Unsaved Stories',
      message: 'Discard unsaved story changes?',
      detail: 'One or more open stories contain edits that have not been saved.',
      buttons: ['Cancel', 'Discard'],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 1) {
      storyDirty = false;
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
