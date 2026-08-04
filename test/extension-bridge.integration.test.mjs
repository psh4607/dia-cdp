import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
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

function requestWebSocketUpgrade({ port, token, origin }) {
  return new Promise((resolveStatus, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: `/bridge${token ? `?token=${encodeURIComponent(token)}` : ''}`,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
        ...(origin ? { Origin: origin } : {}),
      },
    });
    request.on('upgrade', (_response, socket) => {
      socket.destroy();
      resolveStatus(101);
    });
    request.on('response', (response) => {
      response.resume();
      resolveStatus(response.statusCode);
    });
    request.on('error', reject);
    request.end();
  });
}

describe('Dia extension bridge', () => {
  it('reports relay health without waiting for the browser extension', async () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'dia-extension-health-'));
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

    const result = await sendBridgeRequest('relay.health', {}, {
      autoStart: false,
      socketPath,
      timeoutMs: 500,
    });

    assert.equal(result.relay, 'running');
    assert.equal(result.extensionConnected, false);
    assert.equal(result.pendingRequests, 0);
    assert.equal(typeof result.uptimeSeconds, 'number');
  });

  it('keeps the active relay socket when a duplicate instance starts', { timeout: 2_000 }, async () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'dia-extension-singleton-'));
    temporaryDirectories.push(directory);
    const socketPath = resolve(directory, 'bridge.sock');
    const relayPort = await getAvailablePort();
    const env = {
      ...process.env,
      DIA_EXTENSION_RELAY_PORT: String(relayPort),
      DIA_EXTENSION_SOCKET: socketPath,
      DIA_EXTENSION_TOKEN: 'test-bridge-token',
    };
    const first = spawn(process.execPath, [resolve(root, 'src/extension-host.mjs')], {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    childProcesses.push(first);
    await waitForPath(socketPath);

    const duplicate = spawn(process.execPath, [resolve(root, 'src/extension-host.mjs')], {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    childProcesses.push(duplicate);
    const duplicateExit = await Promise.race([
      new Promise((resolveExit) => duplicate.once('exit', resolveExit)),
      delay(750).then(() => 'timeout'),
    ]);

    assert.notEqual(duplicateExit, 'timeout');
    const result = await sendBridgeRequest('relay.health', {}, {
      autoStart: false,
      socketPath,
      timeoutMs: 500,
    });
    assert.equal(result.relay, 'running');
  });

  it('relays a CLI request through the loopback WebSocket and back', async () => {
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

    const socket = new WebSocket(`ws://127.0.0.1:${relayPort}/bridge?token=${token}`);
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener('open', resolveOpen, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    socket.send(JSON.stringify({ type: 'hello', version: '0.6.0' }));
    const health = await sendBridgeRequest('relay.health', {}, {
      autoStart: false,
      socketPath,
      timeoutMs: 500,
    });
    assert.equal(health.connectionGeneration, 1);
    assert.equal(health.extensionVersion, '0.6.0');
    const simulatedExtension = new Promise((resolveResponse, reject) => {
      socket.addEventListener('message', (event) => {
        try {
          const request = JSON.parse(event.data);
          assert.equal(request.command, 'tabs.list');
          socket.send(JSON.stringify({
            id: request.id,
            ok: true,
            result: [{ id: 7, title: 'Dia', url: 'https://example.com/' }],
          }));
          resolveResponse();
        } catch (error) {
          reject(error);
        }
      }, { once: true });
    });

    const result = await sendBridgeRequest('tabs.list', {}, {
      autoStart: false,
      socketPath,
      timeoutMs: 2_000,
    });
    await simulatedExtension;
    socket.close();

    assert.deepEqual(result, [{ id: 7, title: 'Dia', url: 'https://example.com/' }]);
  });

  it('asks an outdated extension worker to reload the synced payload', { timeout: 1_000 }, async () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'dia-extension-version-'));
    temporaryDirectories.push(directory);
    const socketPath = resolve(directory, 'bridge.sock');
    const relayPort = await getAvailablePort();
    const token = 'test-bridge-token';
    const child = spawn(process.execPath, [resolve(root, 'src/extension-host.mjs')], {
      env: {
        ...process.env,
        DIA_EXTENSION_RELAY_PORT: String(relayPort),
        DIA_EXTENSION_SOCKET: socketPath,
        DIA_EXTENSION_TOKEN: token,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    childProcesses.push(child);
    await waitForPath(socketPath);

    const socket = new WebSocket(`ws://127.0.0.1:${relayPort}/bridge?token=${token}`);
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener('open', resolveOpen, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const reload = new Promise((resolveReload, reject) => {
      socket.addEventListener('message', (event) => {
        try {
          resolveReload(JSON.parse(event.data));
        } catch (error) {
          reject(error);
        }
      }, { once: true });
    });
    socket.send(JSON.stringify({ type: 'hello', version: '0.0.0' }));

    assert.deepEqual(await reload, { type: 'reload' });
    socket.close();
  });

  it('rejects WebSocket upgrades without the bridge token', async () => {
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

    assert.equal(await requestWebSocketUpgrade({ port: relayPort }), 403);
  });

  it('rejects a web origin even if it knows the bridge token', async () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'dia-extension-web-origin-'));
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

    assert.equal(await requestWebSocketUpgrade({
      port: relayPort,
      token: 'test-bridge-token',
      origin: 'https://example.com',
    }), 403);
  });
});
