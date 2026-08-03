import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function extensionIdFromKey(key) {
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((character) => (
    String.fromCharCode(97 + Number.parseInt(character, 16))
  )).join('');
}

describe('Dia extension package', () => {
  it('uses Manifest V3 with minimized permissions', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'extension/manifest.json'), 'utf8'));

    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, '0.2.0');
    assert.equal(extensionIdFromKey(manifest.key), 'jkijmmbnkcgjmpagmpflooolealenfkf');
    assert.equal(manifest.background.type, 'module');
    assert.deepEqual(manifest.permissions, ['tabs']);
    assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*']);
    assert.equal(manifest.permissions.includes('debugger'), false);
    assert.equal(manifest.permissions.includes('scripting'), false);
  });

  it('connects only to the local loopback relay', () => {
    const worker = readFileSync(resolve(root, 'extension/service-worker.js'), 'utf8');

    assert.match(worker, /import \{ BRIDGE_TOKEN, RELAY_ORIGIN \}/);
    assert.match(worker, /fetch\(POLL_URL/);
    assert.match(worker, /fetch\(RESPONSE_URL/);
    assert.match(worker, /handleBridgeRequest\(chrome, request\)/);
    assert.match(worker, /setBridgeBadge\('ON'/);
  });

  it('ships executable bridge entrypoints', () => {
    for (const path of [
      'bin/dia-extension',
      'bin/install-dia-extension-host',
      'skills/dia-cdp/scripts/dia-extension',
    ]) {
      assert.ok(statSync(resolve(root, path)).mode & 0o111, `${path} must be executable`);
    }
  });

  it('installs the loopback relay into a version-independent user path', () => {
    const installer = readFileSync(resolve(root, 'src/install-native-host.mjs'), 'utf8');

    assert.match(installer, /'\.local', 'share', 'dia-cdp', 'relay'/);
    assert.match(installer, /'\.local', 'share', 'dia-cdp', 'extension'/);
    assert.match(installer, /\['manifest\.json', 'commands\.js', 'service-worker\.js'\]/);
    assert.match(installer, /copyFileSync\(resolve\(currentDir, 'extension-host\.mjs'/);
    assert.match(installer, /copyFileSync\(resolve\(currentDir, 'bridge-config\.mjs'/);
    assert.match(installer, /ensureBridgeToken\(tokenPath\)/);
  });
});
