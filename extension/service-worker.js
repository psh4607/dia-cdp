import { BRIDGE_TOKEN, RELAY_ORIGIN } from './bridge-config.js';
import { handleBridgeRequest } from './commands.js';

const MIN_RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const POLL_URL = `${RELAY_ORIGIN}/poll?token=${encodeURIComponent(BRIDGE_TOKEN)}`;
const RESPONSE_URL = `${RELAY_ORIGIN}/response?token=${encodeURIComponent(BRIDGE_TOKEN)}`;
const RELAY_HEADERS = { 'X-Dia-Extension-Id': chrome.runtime.id };

let polling = false;
let reconnectDelayMs = MIN_RECONNECT_DELAY_MS;

function setBridgeBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function sendResponse(response) {
  const result = await fetch(RESPONSE_URL, {
    method: 'POST',
    headers: {
      ...RELAY_HEADERS,
      'Content-Type': 'text/plain;charset=UTF-8',
    },
    body: JSON.stringify(response),
    cache: 'no-store',
  });
  if (!result.ok) throw new Error(`relay response failed with HTTP ${result.status}`);
}

async function pollRelay() {
  if (polling) return;
  polling = true;

  while (polling) {
    try {
      const response = await fetch(POLL_URL, {
        headers: RELAY_HEADERS,
        cache: 'no-store',
      });
      if (response.status === 204) continue;
      if (!response.ok) throw new Error(`relay poll failed with HTTP ${response.status}`);

      reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
      setBridgeBadge('ON', '#188038');
      const request = await response.json();
      try {
        const result = await handleBridgeRequest(chrome, request);
        await sendResponse({ id: request.id, ok: true, result });
      } catch (error) {
        await sendResponse({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (error) {
      setBridgeBadge('OFF', '#B3261E');
      console.warn(
        'Dia Codex Bridge could not reach the local relay.',
        error instanceof Error ? error.message : String(error),
      );
      await delay(reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    }
  }
}

chrome.runtime.onInstalled.addListener(pollRelay);
chrome.runtime.onStartup.addListener(pollRelay);
chrome.action.onClicked.addListener(pollRelay);

setBridgeBadge('…', '#5F6368');
pollRelay();
