import { BRIDGE_TOKEN, RELAY_ORIGIN } from './bridge-config.js';
import { handleBridgeRequest } from './commands.js';
import { createControlChannel } from './control-channel.js';

const MIN_RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const RECONNECT_ALARM = 'dia-extension-reconnect';
const BRIDGE_URL = `${RELAY_ORIGIN.replace('http://', 'ws://')}/bridge?token=${encodeURIComponent(BRIDGE_TOKEN)}`;

let bridgeSocket;
let heartbeatTimer;
let reconnectTimer;
let reconnectDelayMs = MIN_RECONNECT_DELAY_MS;

function setBridgeBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

function clearBridgeTimers() {
  clearInterval(heartbeatTimer);
  clearTimeout(reconnectTimer);
  heartbeatTimer = undefined;
  reconnectTimer = undefined;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connectBridge();
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
}

function sendBridgeMessage(message) {
  if (bridgeSocket?.readyState !== WebSocket.OPEN) return false;
  bridgeSocket.send(JSON.stringify(message));
  return true;
}

const controlChannel = createControlChannel({ send: sendBridgeMessage });

async function handleRelayMessage(event) {
  let request;
  try {
    request = JSON.parse(event.data);
  } catch {
    return;
  }
  if (request?.type === 'reload') {
    chrome.runtime.reload();
    return;
  }
  if (controlChannel.handleMessage(request)) return;
  if (!request || request.type === 'heartbeat') return;

  try {
    const result = await handleBridgeRequest(chrome, request);
    sendBridgeMessage({ id: request.id, ok: true, result });
  } catch (error) {
    sendBridgeMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function connectBridge() {
  if ([WebSocket.CONNECTING, WebSocket.OPEN].includes(bridgeSocket?.readyState)) return;

  clearBridgeTimers();
  bridgeSocket = new WebSocket(BRIDGE_URL);
  bridgeSocket.addEventListener('open', () => {
    reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
    setBridgeBadge('ON', '#188038');
    sendBridgeMessage({ type: 'hello', version: chrome.runtime.getManifest().version });
    heartbeatTimer = setInterval(() => {
      sendBridgeMessage({ type: 'heartbeat', timestamp: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
  });
  bridgeSocket.addEventListener('message', handleRelayMessage);
  bridgeSocket.addEventListener('close', () => {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    bridgeSocket = undefined;
    controlChannel.rejectAll();
    setBridgeBadge('OFF', '#B3261E');
    scheduleReconnect();
  });
  bridgeSocket.addEventListener('error', () => bridgeSocket?.close());
}

function initializeBridge() {
  chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
  connectBridge();
}

chrome.runtime.onInstalled.addListener(initializeBridge);
chrome.runtime.onStartup.addListener(initializeBridge);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) connectBridge();
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'relay-control') return false;
  if (!['relay.capabilities.get', 'relay.capabilities.set'].includes(message.command)) {
    sendResponse({ ok: false, error: 'Unsupported relay control command' });
    return false;
  }
  controlChannel.request(message.command, message.args || {}).then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return true;
});

setBridgeBadge('…', '#5F6368');
initializeBridge();
