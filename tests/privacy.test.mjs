import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collect, createClock, collectors, codexCollector, claudeCodeCollector, antigravityCollector } from '../src/index.mjs';

test('built-in collectors are registered and only quota fields leave the Codex reader', async t => {
  assert.deepEqual(collectors, [codexCollector, claudeCodeCollector, antigravityCollector]);
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'quota-clock-privacy-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const directory = path.join(home, 'sessions', '2026', '11', '14');
  await fs.mkdir(directory, { recursive: true });
  const log = path.join(directory, 'rollout-synthetic.jsonl');
  const privateMarkers = ['synthetic conversation sentinel', 'synthetic-private-cwd', 'synthetic-session-id', 'synthetic-credential-sentinel', 'synthetic-credit-sentinel'];
  await fs.writeFile(log, [
    JSON.stringify({ type: 'session_meta', payload: { cwd: privateMarkers[1], id: privateMarkers[2] } }),
    JSON.stringify({ timestamp: '2026-11-14T13:00:00Z', type: 'event_msg', payload: { type: 'token_count', cwd: privateMarkers[1], rate_limits: { primary: { used_percent: 42, window_minutes: 300, resets_at: 1794664800 }, secondary: { used_percent: 75, window_minutes: 10080, resets_at: 1794668400 }, credits: privateMarkers[4] } } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', content: privateMarkers[0] } }),
  ].join('\n'));
  await fs.writeFile(path.join(home, 'auth.json'), privateMarkers[3]);
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  t.after(() => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; });
  const output = path.join(home, 'output');
  const open = fs.open;
  const opened = [];
  t.mock.method(fs, 'open', async (...args) => { opened.push(args[0]); return open(...args); });
  const records = await collect({ home: output });
  assert.equal(records.length, 2);
  const clock = createClock({ home: output, now: new Date('2026-11-14T13:00:00Z') });
  const synced = await clock.sync();
  assert.deepEqual(opened, [log, log]);
  t.mock.restoreAll();
  const savedRaw = await fs.readFile(path.join(output, 'data.json'), 'utf8');
  const result = JSON.stringify({ records, synced, listed: clock.list(), savedRaw });
  for (const marker of privateMarkers) assert.ok(!result.includes(marker), marker);
  assert.ok(!result.includes(log));
  assert.ok(!result.includes('cwd'));
  assert.ok(!result.includes('credits'));
  const saved = JSON.parse(savedRaw);
  for (const window of Object.values(saved.services.codex.windows)) {
    assert.deepEqual(Object.keys(window).sort(), ['resetAt', 'periodMinutes', 'note', 'usedPercent', 'source', 'fetchedAt'].sort());
  }
  for (const record of records) {
    assert.deepEqual(Object.keys(record).sort(), ['service', 'window', 'resetAt', 'periodMinutes', 'usedPercent', 'source', 'fetchedAt'].sort());
  }
});
