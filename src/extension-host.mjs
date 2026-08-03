#!/usr/bin/env node

import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import net from 'node:net';
import {
  DEFAULT_EXTENSION_ID,
  DEFAULT_RELAY_PORT,
  ensureBridgeToken,
} from './bridge-config.mjs';

const REQUEST_TIMEOUT_MS = 15_000;
const POLL_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 1_048_576;
const socketPath = process.env.DIA_EXTENSION_SOCKET
  || resolve(homedir(), '.cache', 'dia-cdp', 'extension-bridge.sock');
const relayPort = Number(process.env.DIA_EXTENSION_RELAY_PORT || DEFAULT_RELAY_PORT);
const bridgeToken = ensureBridgeToken();
const allowedOrigin = `chrome-extension://${process.env.DIA_EXTENSION_ID || DEFAULT_EXTENSION_ID}`;

process.umask(0o077);
mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
if (existsSync(socketPath)) unlinkSync(socketPath);

let nextRequestId = 1;
const pending = new Map();
const queuedRequests = [];
const waitingPolls = [];

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

function applyCors(response) {
  response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Dia-Extension-Id');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Origin');
}

function sendJson(response, status, value) {
  applyCors(response);
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

function sendEmpty(response, status = 204) {
  applyCors(response);
  response.writeHead(status);
  response.end();
}

function dispatchQueuedRequest() {
  while (queuedRequests.length && waitingPolls.length) {
    const request = queuedRequests.shift();
    const { response, timer } = waitingPolls.shift();
    clearTimeout(timer);
    sendJson(response, 200, request);
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

  const bridgeId = nextRequestId++;
  const timer = setTimeout(() => {
    const entry = pending.get(bridgeId);
    if (!entry) return;
    pending.delete(bridgeId);
    const queuedIndex = queuedRequests.findIndex((item) => item.id === bridgeId);
    if (queuedIndex >= 0) queuedRequests.splice(queuedIndex, 1);
    writeSocketResponse(entry.connection, {
      id: entry.requestId,
      ok: false,
      error: `extension request timed out after ${REQUEST_TIMEOUT_MS}ms`,
    });
  }, REQUEST_TIMEOUT_MS);

  pending.set(bridgeId, { connection, requestId: request.id, timer });
  queuedRequests.push({
    id: bridgeId,
    command: request.command,
    args: request.args || {},
  });
  dispatchQueuedRequest();
}

function readRequestBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error('response body is too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolveBody(body));
    request.on('error', reject);
  });
}

function isAuthorized(request, url) {
  const origin = request.headers.origin;
  return (origin === undefined || origin === allowedOrigin)
    && request.headers['x-dia-extension-id'] === (process.env.DIA_EXTENSION_ID || DEFAULT_EXTENSION_ID)
    && url.searchParams.get('token') === bridgeToken;
}

const httpServer = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${relayPort}`);

  if (request.method === 'OPTIONS') {
    if (request.headers.origin !== undefined && request.headers.origin !== allowedOrigin) {
      sendEmpty(response, 403);
      return;
    }
    sendEmpty(response);
    return;
  }

  if (!isAuthorized(request, url)) {
    sendEmpty(response, 403);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/poll') {
    const timer = setTimeout(() => {
      const index = waitingPolls.findIndex((entry) => entry.response === response);
      if (index >= 0) waitingPolls.splice(index, 1);
      sendEmpty(response);
    }, POLL_TIMEOUT_MS);
    waitingPolls.push({ response, timer });
    response.on('close', () => {
      const index = waitingPolls.findIndex((entry) => entry.response === response);
      if (index >= 0) {
        clearTimeout(waitingPolls[index].timer);
        waitingPolls.splice(index, 1);
      }
    });
    dispatchQueuedRequest();
    return;
  }

  if (request.method === 'POST' && url.pathname === '/response') {
    try {
      const bridgeResponse = JSON.parse(await readRequestBody(request));
      const entry = pending.get(bridgeResponse.id);
      if (entry) {
        pending.delete(bridgeResponse.id);
        clearTimeout(entry.timer);
        writeSocketResponse(entry.connection, {
          ...bridgeResponse,
          id: entry.requestId,
        });
      }
      sendEmpty(response);
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  sendEmpty(response, 404);
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
  process.exitCode = 1;
}

httpServer.on('error', fail);
socketServer.on('error', fail);

httpServer.listen(relayPort, '127.0.0.1');
socketServer.listen(socketPath, () => chmodSync(socketPath, 0o600));

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  rejectPending('Dia extension relay disconnected');
  for (const { response, timer } of waitingPolls.splice(0)) {
    clearTimeout(timer);
    sendEmpty(response, 503);
  }
  socketServer.close();
  httpServer.close();
  if (existsSync(socketPath)) unlinkSync(socketPath);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
