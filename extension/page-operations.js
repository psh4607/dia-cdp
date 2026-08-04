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
