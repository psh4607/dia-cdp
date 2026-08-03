import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sendBridgeRequest } from '../src/extension-client.mjs';

const root = resolve(import.meta.dirname, '..');
const temporaryDirectories = [];
const childProcesses = [];

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      delay(1_000).then(() => child.kill('SIGKILL')),
    ]);
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function waitForPath(path) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (existsSync(path)) return;
    await delay(20);
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

describe('Dia extension bridge', () => {
  it('relays a CLI request through the loopback HTTP endpoint and back', async () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'dia-extension-bridge-'));
    temporaryDirectories.push(directory);
    const socketPath = resolve(directory, 'bridge.sock');
    const relayPort = await getAvailablePort();
    const token = 'test-bridge-token';
    const extensionId = 'jkijmmbnkcgjmpagmpflooolealenfkf';
    const child = spawn(process.execPath, [resolve(root, 'src/extension-host.mjs')], {
      env: {
        ...process.env,
        DIA_EXTENSION_ID: extensionId,
        DIA_EXTENSION_RELAY_PORT: String(relayPort),
        DIA_EXTENSION_SOCKET: socketPath,
        DIA_EXTENSION_TOKEN: token,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    childProcesses.push(child);

    await waitForPath(socketPath);

    const simulatedExtension = (async () => {
      const poll = await fetch(`http://127.0.0.1:${relayPort}/poll?token=${token}`, {
        headers: { 'X-Dia-Extension-Id': extensionId },
      });
      assert.equal(poll.status, 200);
      const request = await poll.json();
      assert.equal(request.command, 'tabs.list');
      const response = await fetch(`http://127.0.0.1:${relayPort}/response?token=${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'X-Dia-Extension-Id': extensionId,
        },
        body: JSON.stringify({
          id: request.id,
          ok: true,
          result: [{ id: 7, title: 'Dia', url: 'https://example.com/' }],
        }),
      });
      assert.equal(response.status, 204);
    })();

    const result = await sendBridgeRequest('tabs.list', {}, {
      autoStart: false,
      socketPath,
      timeoutMs: 2_000,
    });
    await simulatedExtension;

    assert.deepEqual(result, [{ id: 7, title: 'Dia', url: 'https://example.com/' }]);
  });

  it('rejects loopback requests without the extension identity', async () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'dia-extension-origin-'));
    temporaryDirectories.push(directory);
    const socketPath = resolve(directory, 'bridge.sock');
    const relayPort = await getAvailablePort();
    const child = spawn(process.execPath, [resolve(root, 'src/extension-host.mjs')], {
      env: {
        ...process.env,
        DIA_EXTENSION_RELAY_PORT: String(relayPort),
        DIA_EXTENSION_SOCKET: socketPath,
        DIA_EXTENSION_TOKEN: 'test-bridge-token',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    childProcesses.push(child);
    await waitForPath(socketPath);

    const response = await fetch(`http://127.0.0.1:${relayPort}/poll?token=test-bridge-token`);
    assert.equal(response.status, 403);
  });

  it('rejects a web origin even if it copies the extension identity header', async () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'dia-extension-web-origin-'));
    temporaryDirectories.push(directory);
    const socketPath = resolve(directory, 'bridge.sock');
    const relayPort = await getAvailablePort();
    const extensionId = 'jkijmmbnkcgjmpagmpflooolealenfkf';
    const child = spawn(process.execPath, [resolve(root, 'src/extension-host.mjs')], {
      env: {
        ...process.env,
        DIA_EXTENSION_ID: extensionId,
        DIA_EXTENSION_RELAY_PORT: String(relayPort),
        DIA_EXTENSION_SOCKET: socketPath,
        DIA_EXTENSION_TOKEN: 'test-bridge-token',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    childProcesses.push(child);
    await waitForPath(socketPath);

    const response = await fetch(`http://127.0.0.1:${relayPort}/poll?token=test-bridge-token`, {
      headers: {
        Origin: 'https://example.com',
        'X-Dia-Extension-Id': extensionId,
      },
    });
    assert.equal(response.status, 403);
  });
});
