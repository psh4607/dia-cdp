const GET_CAPABILITIES = {
  type: 'relay-control',
  command: 'relay.capabilities.get',
  args: {},
};

export function createPopupController({ elements, sendMessage }) {
  const { status, toggle, error } = elements;

  function showError(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  function renderConnected(pageEval) {
    status.textContent = 'Bridge connected';
    status.dataset.state = 'connected';
    toggle.checked = Boolean(pageEval);
    toggle.disabled = false;
    showError('');
  }

  function renderUnavailable(message) {
    status.textContent = 'Bridge unavailable';
    status.dataset.state = 'unavailable';
    toggle.checked = false;
    toggle.disabled = true;
    showError(message);
  }

  async function request(message) {
    const response = await sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || 'Relay did not respond');
    return response.result;
  }

  async function refresh() {
    toggle.disabled = true;
    try {
      const capabilities = await request(GET_CAPABILITIES);
      renderConnected(capabilities.pageEval);
    } catch (requestError) {
      renderUnavailable(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  async function setPageEval(enabled, previousEnabled = !enabled) {
    toggle.disabled = true;
    showError('');
    try {
      const capabilities = await request({
        type: 'relay-control',
        command: 'relay.capabilities.set',
        args: { name: 'page-eval', enabled },
      });
      renderConnected(capabilities.pageEval);
    } catch (requestError) {
      status.textContent = 'Bridge connected';
      status.dataset.state = 'connected';
      toggle.checked = previousEnabled;
      toggle.disabled = false;
      showError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  return { refresh, setPageEval };
}

function initializePopup() {
  const elements = {
    status: document.querySelector('#bridge-status'),
    toggle: document.querySelector('#page-eval-toggle'),
    error: document.querySelector('#error-message'),
  };
  const controller = createPopupController({
    elements,
    sendMessage: (message) => chrome.runtime.sendMessage(message),
  });
  let previousEnabled = false;

  elements.toggle.addEventListener('change', () => {
    const enabled = elements.toggle.checked;
    controller.setPageEval(enabled, previousEnabled).then(() => {
      previousEnabled = elements.toggle.checked;
    });
  });

  const refresh = () => controller.refresh().then(() => {
    previousEnabled = elements.toggle.checked;
  });
  refresh();
  setInterval(refresh, 2_000);
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined') {
  initializePopup();
}
