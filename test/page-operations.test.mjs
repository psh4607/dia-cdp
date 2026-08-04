import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeLoadAll,
  executePageEvaluation,
  executePageOperation,
} from '../extension/page-operations.js';

const originalDocument = globalThis.document;
const originalLocation = globalThis.location;
const originalWindow = globalThis.window;
const originalKeyboardEvent = globalThis.KeyboardEvent;
const originalMouseEvent = globalThis.MouseEvent;
const originalPerformance = globalThis.performance;

afterEach(() => {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalLocation === undefined) delete globalThis.location;
  else globalThis.location = originalLocation;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalKeyboardEvent === undefined) delete globalThis.KeyboardEvent;
  else globalThis.KeyboardEvent = originalKeyboardEvent;
  if (originalMouseEvent === undefined) delete globalThis.MouseEvent;
  else globalThis.MouseEvent = originalMouseEvent;
  globalThis.performance = originalPerformance;
});

describe('Dia page operations', () => {
  it('reads bounded text from a selected element', () => {
    globalThis.document = {
      querySelector: (selector) => selector === 'main'
        ? { innerText: 'Hello from Dia' }
        : null,
    };

    assert.deepEqual(executePageOperation('text', { selector: 'main' }), {
      selector: 'main',
      text: 'Hello from Dia',
      truncated: false,
    });
  });

  it('returns a compact page snapshot with actionable selectors', () => {
    const button = {
      id: 'save',
      tagName: 'BUTTON',
      localName: 'button',
      innerText: 'Save',
      getAttribute: (name) => ({ role: null, 'aria-label': 'Save changes' })[name] ?? null,
    };
    globalThis.document = {
      title: 'Editor',
      body: { innerText: 'Edit profile\nSave' },
      querySelectorAll: () => [button],
    };
    globalThis.location = { href: 'https://example.com/editor' };

    assert.deepEqual(executePageOperation('snapshot'), {
      title: 'Editor',
      url: 'https://example.com/editor',
      text: 'Edit profile\nSave',
      textTruncated: false,
      elements: [{
        selector: '[id="save"]',
        tag: 'button',
        text: 'Save',
        ariaLabel: 'Save changes',
      }],
      elementsTruncated: false,
    });
  });

  it('returns bounded resource timing entries without CDP', () => {
    globalThis.performance = {
      getEntriesByType: () => [{
        name: 'https://example.com/app.js',
        initiatorType: 'script',
        startTime: 12.4,
        duration: 35.6,
        transferSize: 1024,
        encodedBodySize: 900,
        decodedBodySize: 1800,
      }],
    };

    assert.deepEqual(executePageOperation('network'), {
      entries: [{
        name: 'https://example.com/app.js',
        type: 'script',
        startTime: 12,
        duration: 36,
        transferSize: 1024,
        encodedBodySize: 900,
        decodedBodySize: 1800,
      }],
      truncated: false,
    });
  });

  it('evaluates JavaScript with bounded serializable results', async () => {
    globalThis.document = { title: 'Dia Eval' };

    assert.deepEqual(await executePageEvaluation('Promise.resolve(document.title)'), {
      type: 'string',
      value: 'Dia Eval',
      truncated: false,
    });
    assert.deepEqual(await executePageEvaluation('({ answer: 42 })'), {
      type: 'object',
      value: { answer: 42 },
      truncated: false,
    });
  });

  it('clicks the element at viewport coordinates without CDP', () => {
    let clicks = 0;
    const element = {
      localName: 'button',
      click: () => { clicks += 1; },
    };
    globalThis.document = { elementFromPoint: (x, y) => x === 120 && y === 240 ? element : null };

    assert.deepEqual(executePageOperation('clickxy', { x: 120, y: 240 }), {
      clicked: true,
      x: 120,
      y: 240,
      tag: 'button',
    });
    assert.equal(clicks, 1);
  });

  it('repeatedly clicks until the selector disappears with a hard click bound', async () => {
    let remaining = 2;
    const button = {
      scrollIntoView() {},
      click() { remaining -= 1; },
    };
    globalThis.document = {
      querySelector: () => remaining > 0 ? button : null,
    };

    assert.deepEqual(await executeLoadAll({
      selector: '.load-more',
      intervalMs: 0,
      maxClicks: 10,
    }), {
      selector: '.load-more',
      clicks: 2,
      stoppedBecause: 'missing',
    });
  });

  it('types into a form control and dispatches input events', () => {
    const events = [];
    const input = {
      value: 'old',
      focusCalled: false,
      focus() { this.focusCalled = true; },
      dispatchEvent(event) { events.push(event.type); },
    };
    globalThis.document = {
      querySelector: (selector) => selector === '#name' ? input : null,
    };

    assert.deepEqual(executePageOperation('type', {
      selector: '#name',
      text: 'Seongho',
    }), {
      typed: true,
      selector: '#name',
      length: 7,
    });
    assert.equal(input.value, 'Seongho');
    assert.equal(input.focusCalled, true);
    assert.deepEqual(events, ['input', 'change']);
  });

  it('queries one element using the same actionable summary format', () => {
    const link = {
      id: 'docs',
      tagName: 'A',
      localName: 'a',
      innerText: 'Documentation',
      getAttribute: (name) => name === 'role' ? 'link' : null,
    };
    globalThis.document = {
      querySelector: (selector) => selector === '#docs' ? link : null,
    };

    assert.deepEqual(executePageOperation('query', { selector: '#docs' }), {
      selector: '[id="docs"]',
      tag: 'a',
      text: 'Documentation',
      role: 'link',
    });
  });

  it('reads bounded HTML from a selected element', () => {
    globalThis.document = {
      querySelector: (selector) => selector === 'main'
        ? { outerHTML: '<main><h1>Hello</h1></main>' }
        : null,
    };

    assert.deepEqual(executePageOperation('html', { selector: 'main', maxChars: 12 }), {
      selector: 'main',
      html: '<main><h1>He',
      truncated: true,
    });
  });

  it('focuses a selected element', () => {
    const input = { focusCalled: false, focus() { this.focusCalled = true; } };
    globalThis.document = {
      querySelector: (selector) => selector === '#email' ? input : null,
    };

    assert.deepEqual(executePageOperation('focus', { selector: '#email' }), {
      focused: true,
      selector: '#email',
    });
    assert.equal(input.focusCalled, true);
  });

  it('scrolls a selected element into view', () => {
    const calls = [];
    const section = { scrollIntoView: (options) => calls.push(options) };
    globalThis.document = {
      querySelector: (selector) => selector === '#details' ? section : null,
    };

    assert.deepEqual(executePageOperation('scroll', { selector: '#details' }), {
      scrolled: true,
      selector: '#details',
    });
    assert.deepEqual(calls, [{ block: 'center', inline: 'nearest', behavior: 'auto' }]);
  });

  it('selects a form option and dispatches change', () => {
    const events = [];
    const select = {
      value: 'a',
      dispatchEvent: (event) => events.push(event.type),
    };
    globalThis.document = {
      querySelector: (selector) => selector === '#team' ? select : null,
    };

    assert.deepEqual(executePageOperation('select', {
      selector: '#team',
      value: 'b',
    }), {
      selected: true,
      selector: '#team',
      value: 'b',
    });
    assert.equal(select.value, 'b');
    assert.deepEqual(events, ['input', 'change']);
  });

  it('dispatches keyboard events to a selected element', () => {
    const events = [];
    const input = {
      focus() {},
      dispatchEvent: (event) => events.push({ type: event.type, key: event.key }),
    };
    globalThis.KeyboardEvent = class KeyboardEvent {
      constructor(type, init) { this.type = type; Object.assign(this, init); }
    };
    globalThis.document = {
      querySelector: (selector) => selector === '#search' ? input : null,
    };

    assert.deepEqual(executePageOperation('key', {
      selector: '#search',
      key: 'Enter',
    }), {
      pressed: true,
      selector: '#search',
      key: 'Enter',
    });
    assert.deepEqual(events, [
      { type: 'keydown', key: 'Enter' },
      { type: 'keyup', key: 'Enter' },
    ]);
  });
});
