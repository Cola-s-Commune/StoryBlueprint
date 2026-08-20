const { createHash, createPublicKey, verify } = require('node:crypto');
const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const releaseRoot = resolve(__dirname, '../../../release');
const releaseDirectory = resolve(releaseRoot, 'win-unpacked');
const resourcesDirectory = resolve(releaseDirectory, 'resources');
const asarPath = resolve(resourcesDirectory, 'app.asar');
const packageVersion = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
).version;

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

const portable = `StoryBlueprint-Portable-${packageVersion}-x64.exe`;
if (!existsSync(resolve(releaseRoot, portable))) {
  throw new Error(`Windows portable artifact was not found: ${portable}`);
}
if (portable) smokeTest(resolve(releaseRoot, portable), releaseRoot);

const installer = `StoryBlueprint-Setup-${packageVersion}-x64.exe`;
if (!existsSync(resolve(releaseRoot, installer))) {
  throw new Error(`Windows installer was not found: ${installer}`);
}
if (installer && statSync(resolve(releaseRoot, installer)).size < 1024 * 1024) {
  throw new Error(`Windows installer is unexpectedly small: ${installer}`);
}

function sha512(filePath) {
  return createHash('sha512').update(readFileSync(filePath)).digest('base64');
}

const manifests = ['stable.json', 'beta.json']
  .map((name) => ({ name, path: resolve(releaseRoot, name) }))
  .filter(({ path }) => existsSync(path))
  .map(({ name, path }) => ({ name, value: JSON.parse(readFileSync(path, 'utf8')) }));
const matchingManifest = manifests.find(({ value }) => value.latestVersion === packageVersion);
if (!matchingManifest) {
  throw new Error(`No update manifest matches packaged version ${packageVersion}`);
}
const installerPath = resolve(releaseRoot, installer);
const portablePath = resolve(releaseRoot, portable);
const expected = {
  installerUrl: `./${installer}`,
  portableUrl: `./${portable}`,
  installerSize: statSync(installerPath).size,
  portableSize: statSync(portablePath).size,
  installerSha512: sha512(installerPath),
  portableSha512: sha512(portablePath),
};
if (!matchingManifest.value.signature || matchingManifest.value.signature.algorithm !== 'ed25519') {
  throw new Error(`Update manifest ${matchingManifest.name} is missing an Ed25519 signature`);
}
const trustedKeys = JSON.parse(readFileSync(resolve(__dirname, '../update-public-keys.json'), 'utf8'));
const publicKeyDer = trustedKeys[matchingManifest.value.signature.keyId];
if (!publicKeyDer) throw new Error(`Update manifest ${matchingManifest.name} uses an unknown signing key`);
const signedPayload = { ...matchingManifest.value };
delete signedPayload.signature;
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
if (!verify(null, Buffer.from(canonicalJson(signedPayload), 'utf8'), createPublicKey({ key: Buffer.from(publicKeyDer, 'base64'), format: 'der', type: 'spki' }), Buffer.from(matchingManifest.value.signature.value, 'base64'))) {
  throw new Error(`Update manifest ${matchingManifest.name} has an invalid signature`);
}
for (const [key, value] of Object.entries(expected)) {
  if (matchingManifest.value[key] !== value) {
    throw new Error(`Update manifest ${matchingManifest.name} has an invalid ${key}`);
  }
}

console.log(
  `Verified ${executable}, resources/app.asar, ${portable}, ${installer}, and ${matchingManifest.name}`,
);
