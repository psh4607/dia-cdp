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

export async function handleBridgeRequest(chromeApi, request) {
  if (!request || typeof request !== 'object') {
    throw new Error('request must be an object');
  }

  const args = request.args && typeof request.args === 'object' ? request.args : {};

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

    default:
      throw new Error(`unsupported command: ${String(request.command)}`);
  }
}
