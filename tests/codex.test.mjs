import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectCodex, TAIL_BYTES } from '../src/collectors/codex.mjs';
import { collect, createClock } from '../src/index.mjs';

const timestamp = '2026-11-14T13:00:00Z';
const reset = 1794664800;
const event = (limits, extra = {}) => JSON.stringify({ timestamp, type: 'event_msg', payload: { type: 'token_count', rate_limits: limits }, ...extra });
const quota = (used = 42, minutes = 300) => ({ used_percent: used, window_minutes: minutes, resets_at: reset });
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'quota-clock-codex-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  async function rollout(name, text, date = '2026/11/14') {
    const directory = path.join(home, 'sessions', ...date.split('/'));
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, `rollout-${name}.jsonl`);
    await fs.writeFile(file, text);
    return file;
  }
  return { home, rollout };
}

test('Codex maps primary and secondary, copies only quota fields and event timestamp', async t => {
  const { home, rollout } = await fixture(t);
  await rollout('demo', event({ primary: quota(12.5), secondary: quota(90, 10080), credits: { ignored: 'synthetic-private-field' } }));
  const rows = await collectCodex({ codexHome: home });
  assert.deepEqual(rows, [
    { service: 'codex', window: '5h', resetAt: new Date(reset * 1000).toISOString(), periodMinutes: 300, usedPercent: 12.5, source: 'codex-session', fetchedAt: '2026-11-14T13:00:00.000Z' },
    { service: 'codex', window: 'weekly', resetAt: new Date(reset * 1000).toISOString(), periodMinutes: 10080, usedPercent: 90, source: 'codex-session', fetchedAt: '2026-11-14T13:00:00.000Z' },
  ]);
  assert.ok(!JSON.stringify(rows).includes('synthetic-private-field'));
});

test('newest modified file wins even when its date directory and filename are older', async t => {
  const { home, rollout } = await fixture(t);
  const first = await rollout('z', event({ primary: quota(80) }), '2026/11/14');
  const second = await rollout('a', event({ primary: quota(10) }), '2025/01/01');
  await fs.utimes(first, 100, 100);
  await fs.utimes(second, 200, 200);
  assert.equal((await collectCodex({ codexHome: home }))[0].usedPercent, 10);
});

test('latest valid quota event wins and does not merge previous snapshots', async t => {
  const { home, rollout } = await fixture(t);
  const text = [
    event({ primary: quota(20), secondary: quota(80, 10080) }),
    event({ primary: quota(0, 60) }, { timestamp: '2026-11-14T14:00:00+01:00' }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', content: 'synthetic conversation marker' } }),
    event(null),
    '{"type":"event_msg","payload":{"type":"token_count","rate_limits":',
  ].join('\r\n');
  await rollout('latest', text);
  const rows = await collectCodex({ codexHome: home });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].window, '60m');
  assert.equal(rows[0].usedPercent, 0);
  assert.equal(rows[0].fetchedAt, '2026-11-14T13:00:00.000Z');
  assert.ok(!JSON.stringify(rows).includes('synthetic conversation marker'));
});

test('skips malformed events and invalid windows while accepting usage endpoints', async t => {
  const { home, rollout } = await fixture(t);
  for (const invalid of [
    quota(-1), quota(101), quota('42'), quota(42, 0), quota(42, '300'),
    { ...quota(), resets_at: '1794664800' }, { ...quota(), resets_at: -1 }, { ...quota(), resets_at: 1e99 },
  ]) {
    await rollout('invalid', event({ primary: invalid }));
    assert.deepEqual(await collectCodex({ codexHome: home }), []);
  }
  await rollout('invalid', event({ primary: quota() }, { timestamp: 'bad' }));
  assert.deepEqual(await collectCodex({ codexHome: home }), []);
  await rollout('invalid', event({ primary: quota() }, { type: 'response_item' }));
  assert.deepEqual(await collectCodex({ codexHome: home }), []);
  await rollout('invalid', event({ primary: quota(100), secondary: quota(-1, 10080) }));
  assert.equal((await collectCodex({ codexHome: home }))[0].usedPercent, 100);
});

test('missing folders and sessions without usable events return not detected', async t => {
  const { home, rollout } = await fixture(t);
  assert.deepEqual(await collectCodex({ codexHome: path.join(home, 'missing') }), []);
  assert.deepEqual(await collectCodex({ codexHome: home }), []);
  await fs.writeFile(path.join(home, 'auth.json'), 'not a quota source');
  await rollout('empty', '');
  const older = await rollout('older', event({ secondary: quota(60, 10080) }));
  const newer = await rollout('newer', '{"type":"session_meta"}\nnot JSON\n');
  await fs.utimes(older, 100, 100);
  await fs.utimes(newer, 200, 200);
  assert.equal((await collectCodex({ codexHome: home }))[0].window, 'weekly');
});

test('reads at most 256 KiB from the tail and never opens unrelated files', async t => {
  const { home, rollout } = await fixture(t);
  const file = await rollout('large', event({ primary: quota(99) }) + '\n' + 'x'.repeat(TAIL_BYTES * 2) + '\n' + event({ primary: quota(15) }) + '\n');
  await fs.writeFile(path.join(home, 'auth.json'), 'synthetic auth sentinel');
  const open = fs.open;
  const opened = [];
  const reads = [];
  t.mock.method(fs, 'open', async (...args) => {
    opened.push(args[0]);
    const handle = await open(...args);
    const read = handle.read.bind(handle);
    t.mock.method(handle, 'read', async (...args) => {
      reads.push({ length: args[2], position: args[3] });
      return read(...args);
    });
    return handle;
  });
  assert.equal((await collectCodex({ codexHome: home }))[0].usedPercent, 15);
  assert.deepEqual(opened, [file]);
  assert.ok(reads.reduce((sum, read) => sum + read.length, 0) <= TAIL_BYTES);
  const { size } = await fs.stat(file);
  assert.ok(reads.every(read => read.position >= size - TAIL_BYTES));
});

test('does not scan beyond the tail when an earlier event is out of range', async t => {
  const { home, rollout } = await fixture(t);
  await rollout('huge', event({ primary: quota() }) + '\n' + 'x'.repeat(TAIL_BYTES * 2));
  assert.deepEqual(await collectCodex({ codexHome: home }), []);
  await rollout('huge', 'x'.repeat(TAIL_BYTES) + '\n' + event({ primary: quota(25) }));
  assert.equal((await collectCodex({ codexHome: home }))[0].usedPercent, 25);
});

test('built-in collector honors CODEX_HOME and sync saves only normalized quota data', async t => {
  const { home, rollout } = await fixture(t);
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  t.after(() => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; });
  await rollout('sync', event({ primary: quota(25), secondary: quota(75, 10080) }));
  const rows = await collect({ home: path.join(home, 'output') });
  assert.equal(rows.length, 2);
  const clock = createClock({ home: path.join(home, 'output'), now: new Date(timestamp) });
  await clock.sync();
  assert.deepEqual(clock.list().map(row => [row.window, row.usedPercent, row.source]), [['5h', 25, 'codex-session'], ['weekly', 75, 'codex-session']]);
  const saved = JSON.parse(await fs.readFile(path.join(home, 'output', 'data.json')));
  assert.deepEqual(Object.keys(saved.services), ['codex']);
  assert.equal(saved.services.codex.windows['5h'].fetchedAt, '2026-11-14T13:00:00.000Z');
});
