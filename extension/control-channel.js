export function createControlChannel({ send, timeoutMs = 5_000 }) {
  let nextId = 1;
  const pending = new Map();

  function request(command, args = {}) {
    const id = `popup-${Date.now()}-${nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Dia extension bridge control request timed out'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });

      if (!send({ type: 'control-request', id, command, args })) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error('Dia extension bridge is disconnected'));
      }
    });
  }

  function handleMessage(message) {
    if (message?.type !== 'control-response') return false;
    const entry = pending.get(message.id);
    if (!entry) return false;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error || 'Relay control request failed'));
    return true;
  }

  function rejectAll(message = 'Dia extension bridge is disconnected') {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    pending.clear();
  }

  return { request, handleMessage, rejectAll };
}
