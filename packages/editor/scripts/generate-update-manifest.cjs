const { createHash, sign } = require('node:crypto');
const {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const { basename, resolve } = require('node:path');

const workspaceRoot = resolve(__dirname, '../../..');
const releaseRoot = resolve(__dirname, '../../../release');
const packageFile = resolve(__dirname, '../package.json');

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function validateChannel(value) {
  if (value === 'stable' || value === 'beta') return value;
  throw new Error(`Update channel must be stable or beta; received ${value}`);
}

function validateVersion(value) {
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)) return value;
  throw new Error(`Package version is not valid SemVer: ${value}`);
}

function sha512File(filePath) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha512');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('base64')));
  });
}

function readNotes({ notes, notesFile }) {
  if (notes !== undefined && notesFile !== undefined) {
    throw new Error('Use either --notes or --notes-file, not both');
  }
  const value = notesFile ? readFileSync(resolve(workspaceRoot, notesFile), 'utf8') : notes;
  const trimmed = value?.trim() || undefined;
  if (trimmed && trimmed.length > 100_000) throw new Error('Release notes are too large');
  return trimmed;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function resolveSigningKey(options) {
  const hasPrivateKeyOption = Object.prototype.hasOwnProperty.call(options, 'privateKey');
  const hasPrivateKeyFileOption = Object.prototype.hasOwnProperty.call(options, 'privateKeyFile');
  const privateKey = hasPrivateKeyOption
    ? options.privateKey
    : process.env.STORY_BLUEPRINT_UPDATE_PRIVATE_KEY;
  const privateKeyFile = hasPrivateKeyFileOption
    ? options.privateKeyFile
    : process.env.STORY_BLUEPRINT_UPDATE_PRIVATE_KEY_FILE;
  if (privateKey && privateKeyFile) throw new Error('Use either an update private key or a private key file, not both');
  if (!privateKey && !privateKeyFile) {
    throw new Error(
      'Update manifest signing requires STORY_BLUEPRINT_UPDATE_PRIVATE_KEY or STORY_BLUEPRINT_UPDATE_PRIVATE_KEY_FILE',
    );
  }
  return privateKeyFile ? readFileSync(resolve(workspaceRoot, privateKeyFile), 'utf8') : privateKey;
}

function signManifest(manifest, options) {
  const keyId = options.keyId ?? process.env.STORY_BLUEPRINT_UPDATE_KEY_ID ?? 'release-2026';
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) throw new Error(`Invalid update signing key id: ${keyId}`);
  const privateKey = resolveSigningKey(options);
  const value = sign(null, Buffer.from(canonicalJson(manifest), 'utf8'), privateKey).toString('base64');
  return { ...manifest, signature: { algorithm: 'ed25519', keyId, value } };
}

async function generateUpdateManifest(options) {
  const version = validateVersion(options.version);
  const channel = validateChannel(options.channel);
  if (channel === 'stable' && version.includes('-')) {
    throw new Error('A prerelease version cannot be published to the stable channel');
  }
  if (options.releaseDate && Number.isNaN(Date.parse(options.releaseDate))) {
    throw new Error(`Release date is invalid: ${options.releaseDate}`);
  }
  const outputRoot = resolve(options.releaseRoot);
  const installerPath = resolve(outputRoot, `StoryBlueprint-Setup-${version}-x64.exe`);
  const portablePath = resolve(outputRoot, `StoryBlueprint-Portable-${version}-x64.exe`);
  for (const filePath of [installerPath, portablePath]) {
    if (!existsSync(filePath)) throw new Error(`Release artifact does not exist: ${filePath}`);
    if (statSync(filePath).size < 1024 * 1024) {
      throw new Error(`Release artifact is unexpectedly small: ${filePath}`);
    }
  }
  const [installerSha512, portableSha512] = await Promise.all([
    sha512File(installerPath),
    sha512File(portablePath),
  ]);
  const unsignedManifest = {
    format: 'story-blueprint-update',
    version: 1,
    channel,
    latestVersion: version,
    releaseDate: options.releaseDate ?? new Date().toISOString(),
    ...(options.notes ? { notes: options.notes } : {}),
    installerUrl: `./${basename(installerPath)}`,
    portableUrl: `./${basename(portablePath)}`,
    installerSha512,
    portableSha512,
    installerSize: statSync(installerPath).size,
    portableSize: statSync(portablePath).size,
  };
  const manifest = signManifest(unsignedManifest, options);
  const outputPath = resolve(outputRoot, `${channel}.json`);
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, outputPath };
}

async function main() {
  const args = process.argv.slice(2);
  const packageJson = JSON.parse(readFileSync(packageFile, 'utf8'));
  const channel = validateChannel(
    option(args, '--channel') ??
      process.env.STORY_BLUEPRINT_UPDATE_CHANNEL ??
      (packageJson.version.includes('-') ? 'beta' : 'stable'),
  );
  const notesFile = option(args, '--notes-file') ?? process.env.STORY_BLUEPRINT_RELEASE_NOTES_FILE;
  const notes = readNotes({
    notes: option(args, '--notes') ?? process.env.STORY_BLUEPRINT_RELEASE_NOTES,
    notesFile,
  });
  const result = await generateUpdateManifest({
    releaseRoot,
    version: packageJson.version,
    channel,
    releaseDate: option(args, '--release-date'),
    notes,
  });
  console.log(
    `Generated ${result.outputPath} for ${result.manifest.latestVersion} (${channel}) with SHA-512 hashes and Ed25519 signature`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  generateUpdateManifest,
  canonicalJson,
  signManifest,
  sha512File,
  validateChannel,
  validateVersion,
};
