export function executePageOperation(operation, args = {}) {
  function requireSelector(value) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error('selector must be a non-empty string');
    }
    return value;
  }

  function findElement(selector) {
    const element = document.querySelector(requireSelector(selector));
    if (!element) throw new Error(`element not found: ${selector}`);
    return element;
  }

  function boundedString(value, maxChars = 50_000) {
    const text = String(value || '');
    const limit = Number.isInteger(maxChars) && maxChars > 0
      ? Math.min(maxChars, 200_000)
      : 50_000;
    return {
      value: text.slice(0, limit),
      truncated: text.length > limit,
    };
  }

  function escapeAttribute(value) {
    return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  }

  function selectorFor(element) {
    if (element.id) return `[id="${escapeAttribute(element.id)}"]`;
    for (const attribute of ['data-testid', 'aria-label', 'name']) {
      const value = element.getAttribute?.(attribute);
      if (value) return `[${attribute}="${escapeAttribute(value)}"]`;
    }

    const parts = [];
    let current = element;
    while (current?.localName) {
      let part = current.localName;
      const parent = current.parentElement;
      if (parent?.children) {
        const siblings = [...parent.children]
          .filter((sibling) => sibling.localName === current.localName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      if (!parent || parent === document.documentElement) break;
      current = parent;
    }
    return parts.join(' > ');
  }

  function summarizeElement(element) {
    const summary = {
      selector: selectorFor(element),
      tag: String(element.localName || element.tagName || '').toLowerCase(),
      text: String(element.innerText || element.textContent || '').trim().slice(0, 300),
      role: element.getAttribute?.('role') || undefined,
      type: element.getAttribute?.('type') || undefined,
      ariaLabel: element.getAttribute?.('aria-label') || undefined,
      placeholder: element.getAttribute?.('placeholder') || undefined,
    };
    return Object.fromEntries(
      Object.entries(summary).filter(([, value]) => value !== undefined && value !== ''),
    );
  }

  function setElementValue(element, value) {
    if (element.isContentEditable) {
      element.textContent = value;
      return;
    }
    let prototype = Object.getPrototypeOf(element);
    let descriptor;
    while (prototype && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      prototype = Object.getPrototypeOf(prototype);
    }
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  switch (operation) {
    case 'snapshot': {
      const { value: text, truncated: textTruncated } = boundedString(
        document.body?.innerText,
        args.maxChars,
      );
      const allElements = [...document.querySelectorAll(
        'a,button,input,textarea,select,summary,[role],[contenteditable="true"],[tabindex]',
      )];
      const maxElements = Number.isInteger(args.maxElements) && args.maxElements > 0
        ? Math.min(args.maxElements, 1_000)
        : 200;
      return {
        title: document.title,
        url: location.href,
        text,
        textTruncated,
        elements: allElements.slice(0, maxElements).map(summarizeElement),
        elementsTruncated: allElements.length > maxElements,
      };
    }
    case 'text': {
      const selector = args.selector || 'body';
      const { value: text, truncated } = boundedString(
        findElement(selector).innerText,
        args.maxChars,
      );
      return { selector, text, truncated };
    }
    case 'html': {
      const selector = args.selector || 'html';
      const { value: html, truncated } = boundedString(
        findElement(selector).outerHTML,
        args.maxChars,
      );
      return { selector, html, truncated };
    }
    case 'query':
      return summarizeElement(findElement(args.selector));
    case 'network': {
      const allEntries = performance.getEntriesByType('resource');
      const maxEntries = Number.isInteger(args.maxEntries) && args.maxEntries > 0
        ? Math.min(args.maxEntries, 1_000)
        : 500;
      const entries = allEntries.slice(-maxEntries).map((entry) => ({
        name: String(entry.name || '').slice(0, 2_048),
        type: String(entry.initiatorType || 'other').slice(0, 40),
        startTime: Math.round(Number(entry.startTime || 0)),
        duration: Math.round(Number(entry.duration || 0)),
        transferSize: Number(entry.transferSize || 0),
        encodedBodySize: Number(entry.encodedBodySize || 0),
        decodedBodySize: Number(entry.decodedBodySize || 0),
      }));
      return { entries, truncated: allEntries.length > entries.length };
    }
    case 'clickxy': {
      const x = Number(args.x);
      const y = Number(args.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
        throw new Error('x and y must be non-negative finite numbers');
      }
      const element = document.elementFromPoint(x, y);
      if (!element) throw new Error(`no element found at viewport coordinates ${x},${y}`);
      element.click();
      return {
        clicked: true,
        x,
        y,
        tag: String(element.localName || element.tagName || '').toLowerCase(),
      };
    }
    case 'focus': {
      findElement(args.selector).focus();
      return { focused: true, selector: args.selector };
    }
    case 'scroll': {
      if (args.selector) {
        findElement(args.selector).scrollIntoView({
          block: args.block || 'center',
          inline: 'nearest',
          behavior: 'auto',
        });
        return { scrolled: true, selector: args.selector };
      }
      const x = Number(args.x || 0);
      const y = Number(args.y || 0);
      window.scrollBy({ left: x, top: y, behavior: 'auto' });
      return { scrolled: true, x, y };
    }
    case 'click': {
      const element = findElement(args.selector);
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.click();
      return { clicked: true, selector: args.selector };
    }
    case 'type': {
      const element = findElement(args.selector);
      const text = String(args.text ?? '');
      element.focus();
      setElementValue(element, text);
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed: true, selector: args.selector, length: text.length };
    }
    case 'select': {
      const element = findElement(args.selector);
      const value = String(args.value ?? '');
      setElementValue(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { selected: true, selector: args.selector, value };
    }
    case 'key': {
      const element = findElement(args.selector);
      const key = String(args.key || '');
      if (!key) throw new Error('key must be a non-empty string');
      element.focus();
      const init = {
        key,
        code: args.code || '',
        altKey: Boolean(args.altKey),
        ctrlKey: Boolean(args.ctrlKey),
        metaKey: Boolean(args.metaKey),
        shiftKey: Boolean(args.shiftKey),
        bubbles: true,
        composed: true,
      };
      element.dispatchEvent(new KeyboardEvent('keydown', init));
      element.dispatchEvent(new KeyboardEvent('keyup', init));
      return { pressed: true, selector: args.selector, key };
    }
    default:
      throw new Error(`unsupported page operation: ${String(operation)}`);
  }
}

export async function executePageEvaluation(expression, maxChars = 200_000) {
  if (typeof expression !== 'string' || expression.trim() === '') {
    throw new Error('expression must be a non-empty string');
  }
  if (expression.length > 100_000) throw new Error('expression exceeds 100000 characters');
  const limit = Number.isInteger(maxChars) && maxChars > 0
    ? Math.min(maxChars, 200_000)
    : 200_000;
  const value = await (0, eval)(expression);
  const type = value === null ? 'null' : typeof value;
  if (value === undefined) return { type: 'undefined', truncated: false };
  if (type === 'string') {
    return { type, value: value.slice(0, limit), truncated: value.length > limit };
  }
  if (['number', 'boolean'].includes(type) || value === null) {
    return { type, value, truncated: false };
  }

  const seen = new WeakSet();
  const json = JSON.stringify(value, (_key, nested) => {
    if (typeof nested === 'bigint') return `${nested}n`;
    if (typeof nested === 'function') return `[Function ${nested.name || 'anonymous'}]`;
    if (typeof nested === 'symbol') return String(nested);
    if (nested && typeof nested === 'object') {
      if (seen.has(nested)) return '[Circular]';
      seen.add(nested);
    }
    return nested;
  });
  if (json === undefined) return { type, value: String(value), truncated: false };
  if (json.length > limit) {
    return { type, value: json.slice(0, limit), format: 'json', truncated: true };
  }
  return { type, value: JSON.parse(json), truncated: false };
}

export async function executeLoadAll(args = {}) {
  const selector = String(args.selector || '');
  if (!selector) throw new Error('selector must be a non-empty string');
  const intervalMs = Number(args.intervalMs ?? 1_500);
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new Error('intervalMs must be a non-negative number');
  }
  const maxClicks = Number.isInteger(args.maxClicks) && args.maxClicks > 0
    ? Math.min(args.maxClicks, 200)
    : 200;
  const deadline = Date.now() + 300_000;
  let clicks = 0;
  while (clicks < maxClicks && Date.now() < deadline) {
    const element = document.querySelector(selector);
    if (!element) {
      return { selector, clicks, stoppedBecause: 'missing' };
    }
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.click();
    clicks += 1;
    if (intervalMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
    }
  }
  return {
    selector,
    clicks,
    stoppedBecause: clicks >= maxClicks ? 'max-clicks' : 'timeout',
  };
}
