import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collect, createClock } from '../src/index.mjs';

test('default collection never opens sessions, credentials or conversation files', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'quota-clock-privacy-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const directory = path.join(home, 'sessions', '2026', '11', '14');
  await fs.mkdir(directory, { recursive: true });
  const log = path.join(directory, 'rollout-synthetic.jsonl');
  const auth = path.join(home, 'auth.json');
  await fs.writeFile(log, JSON.stringify({ timestamp: '2026-11-14T13:00:00Z', type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 42, window_minutes: 300, resets_at: 1794664800 } } } }) + '\n' + JSON.stringify({ type: 'response_item', payload: { type: 'message', content: 'synthetic conversation sentinel' } }) + '\n');
  await fs.writeFile(auth, 'synthetic credential sentinel');
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  t.after(() => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; });
  const output = path.join(home, 'output');
  const cache = path.join(output, 'claude-code.json');
  const clock = createClock({ home: output });
  // The registered Claude collector may check its dedicated cache, never Codex sources.
  const calls = [];
  const forbid = name => (...args) => { calls.push(name); throw new Error(`Unexpected source access: ${name}`); };
  for (const method of ['open', 'readFile', 'readdir', 'stat', 'lstat', 'access']) t.mock.method(fs, method, forbid(method));
  for (const method of ['openSync', 'readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'createReadStream']) t.mock.method(fsSync, method, forbid(method));
  t.mock.method(fsSync, 'existsSync', file => {
    assert.equal(file, cache, 'only the quota-only Claude cache may be checked');
    calls.push('claude-cache-exists');
    return false;
  });
  assert.deepEqual(await collect({ home: output }), []);
  assert.deepEqual(await clock.sync(), []);
  assert.deepEqual(calls, ['claude-cache-exists', 'claude-cache-exists']);
  t.mock.restoreAll();
  assert.equal(fsSync.existsSync(path.join(home, 'output')), false);
});
