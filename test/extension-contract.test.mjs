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
  it('uses Manifest V3 with scripting access but no debugger permission', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'extension/manifest.json'), 'utf8'));

    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, '0.8.0');
    assert.equal(extensionIdFromKey(manifest.key), 'jkijmmbnkcgjmpagmpflooolealenfkf');
    assert.equal(manifest.background.type, 'module');
    assert.deepEqual(manifest.permissions, ['tabs', 'scripting', 'alarms']);
    assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*', '<all_urls>']);
    assert.equal(manifest.permissions.includes('debugger'), false);
    assert.equal(manifest.permissions.includes('nativeMessaging'), false);
    assert.equal(manifest.action.default_popup, 'popup.html');
  });

  it('keeps the service worker alive through a local WebSocket heartbeat', () => {
    const worker = readFileSync(resolve(root, 'extension/service-worker.js'), 'utf8');

    assert.match(worker, /import \{ BRIDGE_TOKEN, RELAY_ORIGIN \}/);
    assert.match(worker, /new WebSocket\(BRIDGE_URL\)/);
    assert.match(worker, /type: 'heartbeat'/);
    assert.match(worker, /type: 'hello'/);
    assert.match(worker, /chrome\.runtime\.getManifest\(\)\.version/);
    assert.match(worker, /chrome\.runtime\.reload\(\)/);
    assert.match(worker, /chrome\.alarms\.create/);
    assert.match(worker, /chrome\.alarms\.onAlarm\.addListener/);
    assert.match(worker, /handleBridgeRequest\(chrome, request\)/);
    assert.match(worker, /setBridgeBadge\('ON'/);
    assert.match(worker, /chrome\.runtime\.onMessage\.addListener/);
    assert.match(worker, /relay\.capabilities\.(get|set)/);
    assert.doesNotMatch(worker, /fetch\(POLL_URL/);
  });

  it('accepts bounded multi-megabyte screenshot responses', () => {
    const host = readFileSync(resolve(root, 'src/extension-host.mjs'), 'utf8');

    assert.match(host, /const MAX_BODY_BYTES = 16_777_216/);
    assert.match(host, /const REQUEST_TIMEOUT_MS = 45_000/);
    assert.match(host, /const LONG_REQUEST_TIMEOUT_MS = 310_000/);
    assert.match(host, /request\.command === 'page\.loadall'/);
    assert.doesNotMatch(host, /url\.pathname === '\/(poll|response)'/);
    assert.match(host, /expectedExtensionVersion/);
    assert.match(host, /type === 'hello'/);
    assert.match(host, /type: 'reload'/);
  });

  it('ships executable bridge entrypoints', () => {
    for (const path of [
      'bin/dia-extension',
      'bin/dia-browser',
      'bin/dia-automation',
      'bin/dia-lifecycle',
      'bin/install-dia-extension-host',
      'skills/dia-cdp/scripts/dia-browser',
      'skills/dia-cdp/scripts/dia-automation',
      'skills/dia-cdp/scripts/dia-extension',
    ]) {
      assert.ok(statSync(resolve(root, path)).mode & 0o111, `${path} must be executable`);
    }
  });

  it('installs the loopback relay into a version-independent user path', () => {
    const installer = readFileSync(resolve(root, 'src/install-native-host.mjs'), 'utf8');

    assert.match(installer, /'\.local', 'share', 'dia-cdp', 'relay'/);
    assert.match(installer, /'\.local', 'share', 'dia-cdp', 'extension'/);
    for (const fileName of [
      'manifest.json',
      'commands.js',
      'page-operations.js',
      'control-channel.js',
      'service-worker.js',
      'popup.html',
      'popup.css',
      'popup.js',
    ]) {
      assert.match(installer, new RegExp(`'${fileName.replace('.', '\\.')}'`));
    }
    assert.match(installer, /copyFileSync\(resolve\(currentDir, 'extension-host\.mjs'/);
    assert.match(installer, /copyFileSync\(resolve\(currentDir, 'bridge-config\.mjs'/);
    assert.match(installer, /copyFileSync\(resolve\(currentDir, 'bridge-capabilities\.mjs'/);
    assert.match(installer, /ensureBridgeToken\(tokenPath\)/);
  });

  it('installs a crash-restarting user LaunchAgent for the relay', () => {
    const installer = readFileSync(resolve(root, 'src/install-native-host.mjs'), 'utf8');

    assert.match(installer, /Library', 'LaunchAgents'/);
    assert.match(installer, /com\.psh4607\.dia-cdp\.relay/);
    assert.match(installer, /<key>RunAtLoad<\/key>/);
    assert.match(installer, /<key>KeepAlive<\/key>/);
    assert.match(installer, /launchctl/);
    assert.match(installer, /bootstrap/);
    assert.match(installer, /kickstart/);
  });

  it('documents the relay-backed popup capability toggle', () => {
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

    assert.match(readme, /extension icon/i);
    assert.match(readme, /Page evaluation/);
    assert.match(readme, /same relay-backed setting/i);
    assert.match(readme, /every two seconds/i);
  });
});
