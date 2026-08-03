import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

export const DEFAULT_EXTENSION_ID = 'jkijmmbnkcgjmpagmpflooolealenfkf';
export const DEFAULT_RELAY_PORT = 47_137;

export function bridgePaths(homeDirectory = homedir()) {
  return {
    socketPath: resolve(homeDirectory, '.cache', 'dia-cdp', 'extension-bridge.sock'),
    tokenPath: resolve(homeDirectory, '.local', 'share', 'dia-cdp', 'bridge-token'),
  };
}

export function ensureBridgeToken(tokenPath = bridgePaths().tokenPath) {
  if (process.env.DIA_EXTENSION_TOKEN) return process.env.DIA_EXTENSION_TOKEN;
  if (existsSync(tokenPath)) return readFileSync(tokenPath, 'utf8').trim();

  const token = randomBytes(32).toString('hex');
  mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 });
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
  return token;
}
