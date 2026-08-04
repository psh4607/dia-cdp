#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_EXTENSION_ID,
  DEFAULT_RELAY_PORT,
  bridgePaths,
  ensureBridgeToken,
} from './bridge-config.mjs';
import {
  readBridgeCapabilities,
  setBridgeCapability,
} from './bridge-capabilities.mjs';

const REQUEST_TIMEOUT_MS = 45_000;
const LONG_REQUEST_TIMEOUT_MS = 310_000;
const MAX_BODY_BYTES = 16_777_216;
const socketPath = process.env.DIA_EXTENSION_SOCKET
  || resolve(homedir(), '.cache', 'dia-cdp', 'extension-bridge.sock');
const relayPort = Number(process.env.DIA_EXTENSION_RELAY_PORT || DEFAULT_RELAY_PORT);
const bridgeToken = ensureBridgeToken();
const capabilitiesPath = process.env.DIA_EXTENSION_CAPABILITIES
  || bridgePaths().capabilitiesPath;
const allowedOrigin = `chrome-extension://${process.env.DIA_EXTENSION_ID || DEFAULT_EXTENSION_ID}`;
const currentDir = dirname(fileURLToPath(import.meta.url));
let expectedExtensionVersion;
try {
  const manifestPath = resolve(currentDir, '..', 'extension', 'manifest.json');
  expectedExtensionVersion = JSON.parse(readFileSync(manifestPath, 'utf8')).version;
} catch {
  expectedExtensionVersion = undefined;
}

process.umask(0o077);
mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });

let nextRequestId = 1;
const pending = new Map();
const queuedRequests = [];
let bridgeSocket;
let bridgeSocketBuffer = Buffer.alloc(0);
let connectionGeneration = 0;
let extensionVersion;

function writeSocketResponse(connection, response) {
  connection.end(`${JSON.stringify(response)}\n`);
}

function rejectPending(message) {
  for (const { connection, requestId, timer } of pending.values()) {
    clearTimeout(timer);
    writeSocketResponse(connection, { id: requestId, ok: false, error: message });
  }
  pending.clear();
  queuedRequests.length = 0;
}

function dispatchQueuedRequest() {
  if (bridgeSocket?.writable) {
    while (queuedRequests.length) {
      bridgeSocket.write(encodeWebSocketFrame(JSON.stringify(queuedRequests.shift())));
    }
  }
}

function encodeWebSocketFrame(value, opcode = 0x1) {
  const payload = Buffer.from(value);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function handleBridgeResponse(bridgeResponse) {
  if (bridgeResponse?.type === 'heartbeat') return;
  if (bridgeResponse?.type === 'hello') {
    extensionVersion = bridgeResponse.version;
    if (expectedExtensionVersion && bridgeResponse.version !== expectedExtensionVersion) {
      bridgeSocket?.write(encodeWebSocketFrame(JSON.stringify({ type: 'reload' })));
    }
    return;
  }
  if (bridgeResponse?.type === 'control-request') {
    const response = {
      type: 'control-response',
      id: bridgeResponse.id,
      ok: true,
    };
    try {
      if (bridgeResponse.command === 'relay.capabilities.get') {
        response.result = readBridgeCapabilities(capabilitiesPath);
      } else if (bridgeResponse.command === 'relay.capabilities.set') {
        if (typeof bridgeResponse.args?.enabled !== 'boolean') {
          throw new Error('capability enabled state must be a boolean');
        }
        response.result = setBridgeCapability(
          capabilitiesPath,
          bridgeResponse.args.name,
          bridgeResponse.args.enabled,
        );
      } else {
        throw new Error('unsupported relay control command');
      }
    } catch (error) {
      response.ok = false;
      response.error = error instanceof Error ? error.message : String(error);
    }
    bridgeSocket?.write(encodeWebSocketFrame(JSON.stringify(response)));
    return;
  }
  const entry = pending.get(bridgeResponse?.id);
  if (!entry) return;
  pending.delete(bridgeResponse.id);
  clearTimeout(entry.timer);
  writeSocketResponse(entry.connection, {
    ...bridgeResponse,
    id: entry.requestId,
  });
}

function consumeWebSocketFrames(chunk) {
  bridgeSocketBuffer = Buffer.concat([bridgeSocketBuffer, chunk]);
  while (bridgeSocketBuffer.length >= 2) {
    const firstByte = bridgeSocketBuffer[0];
    const secondByte = bridgeSocketBuffer[1];
    const opcode = firstByte & 0x0f;
    const masked = Boolean(secondByte & 0x80);
    let payloadLength = secondByte & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (bridgeSocketBuffer.length < 4) return;
      payloadLength = bridgeSocketBuffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (bridgeSocketBuffer.length < 10) return;
      payloadLength = Number(bridgeSocketBuffer.readBigUInt64BE(2));
      offset = 10;
    }
    if (payloadLength > MAX_BODY_BYTES) {
      bridgeSocket?.destroy(new Error('WebSocket message is too large'));
      return;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = offset + maskLength + payloadLength;
    if (bridgeSocketBuffer.length < frameLength) return;
    const mask = masked ? bridgeSocketBuffer.subarray(offset, offset + 4) : null;
    const payloadStart = offset + maskLength;
    const payload = Buffer.from(
      bridgeSocketBuffer.subarray(payloadStart, payloadStart + payloadLength),
    );
    bridgeSocketBuffer = bridgeSocketBuffer.subarray(frameLength);
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    if (opcode === 0x8) {
      bridgeSocket?.end(encodeWebSocketFrame('', 0x8));
      return;
    }
    if (opcode === 0x9) {
      bridgeSocket?.write(encodeWebSocketFrame(payload, 0xa));
      continue;
    }
    if (opcode !== 0x1) continue;
    try {
      handleBridgeResponse(JSON.parse(payload.toString('utf8')));
    } catch {
      // Ignore malformed extension frames and keep the authenticated channel alive.
    }
  }
}

function queueBridgeRequest(connection, request) {
  if (!request || typeof request !== 'object' || typeof request.command !== 'string') {
    writeSocketResponse(connection, {
      id: request?.id,
      ok: false,
      error: 'request.command must be a string',
    });
    return;
  }

  if (request.command === 'relay.health') {
    writeSocketResponse(connection, {
      id: request.id,
      ok: true,
      result: {
        relay: 'running',
        extensionConnected: Boolean(bridgeSocket?.writable && extensionVersion),
        connectionGeneration,
        extensionVersion,
        pendingRequests: pending.size,
        queuedRequests: queuedRequests.length,
        uptimeSeconds: Math.floor(process.uptime()),
      },
    });
    return;
  }

  if (request.command === 'relay.capabilities.get') {
    writeSocketResponse(connection, {
      id: request.id,
      ok: true,
      result: readBridgeCapabilities(capabilitiesPath),
    });
    return;
  }

  if (request.command === 'relay.capabilities.set') {
    if (typeof request.args?.enabled !== 'boolean') {
      writeSocketResponse(connection, {
        id: request.id,
        ok: false,
        error: 'capability enabled state must be a boolean',
      });
      return;
    }
    try {
      const result = setBridgeCapability(
        capabilitiesPath,
        request.args.name,
        request.args.enabled,
      );
      writeSocketResponse(connection, { id: request.id, ok: true, result });
    } catch (error) {
      writeSocketResponse(connection, { id: request.id, ok: false, error: error.message });
    }
    return;
  }

  if (request.command === 'page.eval' && !readBridgeCapabilities(capabilitiesPath).pageEval) {
    writeSocketResponse(connection, {
      id: request.id,
      ok: false,
      error: 'page-eval capability is disabled; enable it explicitly before evaluating JavaScript',
    });
    return;
  }

  const bridgeId = nextRequestId++;
  const requestTimeoutMs = request.command === 'page.loadall'
    ? LONG_REQUEST_TIMEOUT_MS
    : REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => {
    const entry = pending.get(bridgeId);
    if (!entry) return;
    pending.delete(bridgeId);
    const queuedIndex = queuedRequests.findIndex((item) => item.id === bridgeId);
    if (queuedIndex >= 0) queuedRequests.splice(queuedIndex, 1);
    writeSocketResponse(entry.connection, {
      id: entry.requestId,
      ok: false,
      error: `extension request timed out after ${requestTimeoutMs}ms`,
    });
  }, requestTimeoutMs);

  pending.set(bridgeId, { connection, requestId: request.id, timer });
  queuedRequests.push({
    id: bridgeId,
    command: request.command,
    args: request.args || {},
  });
  dispatchQueuedRequest();
}

const httpServer = http.createServer((_request, response) => {
  response.writeHead(404, { 'Cache-Control': 'no-store' });
  response.end();
});

httpServer.on('upgrade', (request, socket) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${relayPort}`);
  const origin = request.headers.origin;
  const authorizedOrigin = origin === undefined || origin === allowedOrigin;
  const authorized = url.pathname === '/bridge'
    && authorizedOrigin
    && url.searchParams.get('token') === bridgeToken;
  const webSocketKey = request.headers['sec-websocket-key'];
  if (!authorized || typeof webSocketKey !== 'string') {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }

  const accept = createHash('sha1')
    .update(`${webSocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    '',
  ].join('\r\n'));

  if (bridgeSocket && bridgeSocket !== socket) bridgeSocket.destroy();
  bridgeSocket = socket;
  bridgeSocketBuffer = Buffer.alloc(0);
  connectionGeneration += 1;
  extensionVersion = undefined;
  socket.on('data', consumeWebSocketFrames);
  socket.on('close', () => {
    if (bridgeSocket !== socket) return;
    bridgeSocket = undefined;
    bridgeSocketBuffer = Buffer.alloc(0);
    extensionVersion = undefined;
    rejectPending('Dia extension relay disconnected');
  });
  socket.on('error', () => {});
  dispatchQueuedRequest();
});

const socketServer = net.createServer((connection) => {
  let buffer = '';
  connection.setEncoding('utf8');
  connection.on('data', (chunk) => {
    buffer += chunk;
    const newline = buffer.indexOf('\n');
    if (newline === -1) return;

    try {
      queueBridgeRequest(connection, JSON.parse(buffer.slice(0, newline)));
    } catch (error) {
      writeSocketResponse(connection, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

function fail(error) {
  process.stderr.write(`Dia extension relay failed: ${error.message}\n`);
  process.exit(1);
}

httpServer.on('error', fail);
socketServer.on('error', fail);

httpServer.listen(relayPort, '127.0.0.1', () => {
  if (existsSync(socketPath)) unlinkSync(socketPath);
  socketServer.listen(socketPath, () => chmodSync(socketPath, 0o600));
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  rejectPending('Dia extension relay disconnected');
  socketServer.close();
  httpServer.close();
  bridgeSocket?.destroy();
  if (existsSync(socketPath)) unlinkSync(socketPath);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
