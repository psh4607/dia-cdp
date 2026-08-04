import { executePageOperation } from './page-operations.js';

const TAB_FIELDS = [
  'id',
  'windowId',
  'index',
  'active',
  'pinned',
  'audible',
  'discarded',
  'status',
  'title',
  'url',
];
const PAGE_OPERATIONS = new Set([
  'snapshot',
  'query',
  'text',
  'html',
  'click',
  'type',
  'focus',
  'scroll',
  'select',
  'key',
]);

export function sanitizeTab(tab) {
  return Object.fromEntries(
    TAB_FIELDS
      .filter((field) => tab[field] !== undefined)
      .map((field) => [field, tab[field]]),
  );
}

function requireTabId(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('tabId must be a non-negative integer');
  }
  return value;
}

function requireWebUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('url must be a valid http or https URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('url must be a valid http or https URL');
  }
  return url.href;
}

async function captureVisibleTab(chromeApi, windowId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await chromeApi.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (error) {
      const transient = String(error?.message || error).includes('image readback failed');
      if (!transient || attempt === 2) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100 * (attempt + 1)));
    }
  }
  throw new Error('unreachable screenshot retry state');
}

export async function handleBridgeRequest(chromeApi, request) {
  if (!request || typeof request !== 'object') {
    throw new Error('request must be an object');
  }

  const args = request.args && typeof request.args === 'object' ? request.args : {};

  const pageOperation = request.command.startsWith('page.')
    ? request.command.slice('page.'.length)
    : null;
  if (PAGE_OPERATIONS.has(pageOperation)) {
    const { tabId, ...operationArgs } = args;
    const [{ result }] = await chromeApi.scripting.executeScript({
      target: { tabId: requireTabId(tabId) },
      func: executePageOperation,
      args: [pageOperation, operationArgs],
    });
    return result;
  }

  switch (request.command) {
    case 'ping':
      return {
        extension: 'Dia Codex Bridge',
        version: chromeApi.runtime.getManifest().version,
      };

    case 'tabs.list': {
      const tabs = await chromeApi.tabs.query({});
      return tabs.map(sanitizeTab);
    }

    case 'tabs.get': {
      const tab = await chromeApi.tabs.get(requireTabId(args.tabId));
      return sanitizeTab(tab);
    }

    case 'tabs.activate': {
      const tabId = requireTabId(args.tabId);
      const tab = await chromeApi.tabs.update(tabId, { active: true });
      return sanitizeTab(tab);
    }

    case 'tabs.navigate': {
      const tab = await chromeApi.tabs.update(
        requireTabId(args.tabId),
        { url: requireWebUrl(args.url) },
      );
      return sanitizeTab(tab);
    }

    case 'tabs.reload': {
      const tabId = requireTabId(args.tabId);
      await chromeApi.tabs.reload(tabId);
      return { reloaded: true, tabId };
    }

    case 'tabs.create': {
      const tab = await chromeApi.tabs.create({
        url: requireWebUrl(args.url),
        active: args.active !== false,
      });
      return sanitizeTab(tab);
    }

    case 'tabs.close': {
      const tabId = requireTabId(args.tabId);
      await chromeApi.tabs.remove(tabId);
      return { closed: true, tabId };
    }

    case 'page.screenshot': {
      const tabId = requireTabId(args.tabId);
      let tab = await chromeApi.tabs.get(tabId);
      if (!tab.active) tab = await chromeApi.tabs.update(tabId, { active: true });
      const dataUrl = await captureVisibleTab(chromeApi, tab.windowId);
      return { dataUrl, format: 'png' };
    }

    default:
      throw new Error(`unsupported command: ${String(request.command)}`);
  }
}
