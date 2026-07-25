const { spawn } = require('node:child_process');
const { dirname, resolve } = require('node:path');

const cleanEnvironment = { ...process.env };
delete cleanEnvironment.ELECTRON_RUN_AS_NODE;
delete cleanEnvironment.NODE_OPTIONS;

const electronViteEntry = require.resolve('electron-vite');
const electronViteCli = resolve(dirname(electronViteEntry), '../bin/electron-vite.js');
const editorRoot = resolve(__dirname, '..');

const child = spawn(process.execPath, [electronViteCli, 'dev'], {
  stdio: 'inherit',
  cwd: editorRoot,
  env: cleanEnvironment,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
