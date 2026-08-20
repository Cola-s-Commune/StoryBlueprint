const { generateKeyPairSync } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const editorRoot = resolve(__dirname, '..');
const workspaceRoot = resolve(editorRoot, '../..');
const keyId = process.argv[2] ?? process.env.STORY_BLUEPRINT_UPDATE_KEY_ID ?? 'release-2026';
if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) throw new Error(`Invalid update signing key id: ${keyId}`);
const keyDirectory = resolve(workspaceRoot, '.release-keys');
const privatePath = resolve(keyDirectory, `${keyId}.pem`);
if (existsSync(privatePath)) throw new Error(`Refusing to overwrite existing private key: ${privatePath}`);

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
mkdirSync(keyDirectory, { recursive: true });
writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { encoding: 'utf8', mode: 0o600 });
const publicKeysPath = resolve(editorRoot, 'update-public-keys.json');
const publicKeys = JSON.parse(readFileSync(publicKeysPath, 'utf8'));
publicKeys[keyId] = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
writeFileSync(publicKeysPath, `${JSON.stringify(publicKeys, null, 2)}\n`, 'utf8');
console.log(`Created private key ${privatePath}`);
console.log(`Updated trusted public keys ${publicKeysPath}`);
