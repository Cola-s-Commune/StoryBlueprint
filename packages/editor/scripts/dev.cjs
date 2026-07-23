// Clear Electron-in-Electron environment variables.
// WorkBuddy sets ELECTRON_RUN_AS_NODE=1 and NODE_OPTIONS; these break child Electron processes.
// We use shell:true with inline set commands to override the env vars in the shell session itself.
//
// Note: `delete process.env` + `env: cleanEnv` + `shell: true` does NOT work on Windows
// because cmd.exe re-inherits from the SYSTEM environment, bypassing the Node.js env option.
// The only reliable way is to explicitly `set VAR=` inside the shell command.

const { spawn } = require('child_process');
const child = spawn(
  'cmd.exe',
  ['/c', 'set ELECTRON_RUN_AS_NODE=&& set NODE_OPTIONS=&& npx electron-vite dev'],
  {
    stdio: 'inherit',
    cwd: __dirname,
  },
);

child.on('exit', (code) => process.exit(code));
