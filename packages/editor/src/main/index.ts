import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { is } from '@electron-toolkit/utils';

let mainWindow: BrowserWindow | null = null;
let storyDirty = false;

interface SaveStoryRequest {
  filePath?: string;
  content: string;
  saveAs?: boolean;
}

function ensureStoryExtension(filePath: string): string {
  return extname(filePath) ? filePath : `${filePath}.story`;
}

function registerStoryFileHandlers(): void {
  ipcMain.on('story:set-dirty', (_event, dirty: boolean) => {
    storyDirty = dirty === true;
  });
  ipcMain.handle('story:open', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Story',
      properties: ['openFile'],
      filters: [{ name: 'Story Blueprint', extensions: ['story'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    return { canceled: false, filePath, content: await readFile(filePath, 'utf8') };
  });

  ipcMain.handle('story:save', async (_event, request: SaveStoryRequest) => {
    let filePath = request.saveAs ? undefined : request.filePath;
    if (!filePath) {
      const result = await dialog.showSaveDialog({
        title: 'Save Story',
        defaultPath: request.filePath ?? 'untitled.story',
        filters: [{ name: 'Story Blueprint', extensions: ['story'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      filePath = ensureStoryExtension(result.filePath);
    }
    await writeFile(filePath, request.content, 'utf8');
    return { canceled: false, filePath };
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
      title: 'Unsaved Story',
      message: 'Discard unsaved story changes?',
      detail: 'Your latest graph edits have not been saved.',
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
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
});
