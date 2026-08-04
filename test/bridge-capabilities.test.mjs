import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import * as capabilities from '../src/bridge-capabilities.mjs';

describe('bridge capabilities', () => {
  it('keeps arbitrary page evaluation disabled until explicitly enabled', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'dia-capabilities-'));
    const path = resolve(directory, 'capabilities.json');
    try {
      assert.deepEqual(capabilities.readBridgeCapabilities(path), { pageEval: false });
      assert.deepEqual(capabilities.setBridgeCapability(path, 'page-eval', true), {
        pageEval: true,
      });
      assert.deepEqual(capabilities.readBridgeCapabilities(path), { pageEval: true });
      assert.equal(statSync(path).mode & 0o777, 0o600);
      assert.throws(
        () => capabilities.setBridgeCapability(path, 'unknown', true),
        /unknown bridge capability/,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
