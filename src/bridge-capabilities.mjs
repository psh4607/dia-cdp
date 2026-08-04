import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_CAPABILITIES = Object.freeze({ pageEval: false });

export function readBridgeCapabilities(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return { pageEval: parsed.pageEval === true };
  } catch {
    return { ...DEFAULT_CAPABILITIES };
  }
}

export function setBridgeCapability(path, name, enabled) {
  if (name !== 'page-eval') throw new Error(`unknown bridge capability: ${name}`);
  const capabilities = { ...readBridgeCapabilities(path), pageEval: Boolean(enabled) };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(capabilities, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
  return capabilities;
}
