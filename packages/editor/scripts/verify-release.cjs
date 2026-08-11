const { existsSync, readdirSync, statSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const releaseRoot = resolve(__dirname, '../../../release');
const releaseDirectory = resolve(releaseRoot, 'win-unpacked');
const resourcesDirectory = resolve(releaseDirectory, 'resources');
const asarPath = resolve(resourcesDirectory, 'app.asar');

if (!existsSync(releaseDirectory)) {
  throw new Error(`Windows release directory does not exist: ${releaseDirectory}`);
}
if (!existsSync(asarPath) || statSync(asarPath).size < 1024) {
  throw new Error(`Packaged application archive is missing or empty: ${asarPath}`);
}

const executable = readdirSync(releaseDirectory).find(
  (name) => name.toLowerCase().endsWith('.exe') && !name.toLowerCase().includes('uninstall'),
);
if (!executable) throw new Error('Packaged Windows executable was not found');

function smokeTest(filePath, cwd) {
  const result = spawnSync(filePath, ['--smoke-test'], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(`Packaged application smoke test failed${detail ? `:\n${detail}` : ''}`);
  }
}

smokeTest(resolve(releaseDirectory, executable), releaseDirectory);

const portable = readdirSync(releaseRoot).find((name) =>
  /^StoryBlueprint-.*-x64\.exe$/i.test(name),
);
if (portable) smokeTest(resolve(releaseRoot, portable), releaseRoot);

console.log(`Verified ${executable}, resources/app.asar${portable ? `, and ${portable}` : ''}`);
