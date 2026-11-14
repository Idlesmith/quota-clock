import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClock, collect, antigravityCollector } from '../src/index.mjs';
import { ANTIGRAVITY_FILE, extractAntigravityQuota, writeAntigravityStatusline, readAntigravityRecords } from '../src/collectors/antigravity.mjs';

const now = new Date('2026-11-14T13:00:00Z');
const cli = fileURLToPath(new URL('../bin/quota-clock.mjs', import.meta.url));
const reset = '2026-11-14T14:00:00Z';
const markers = ['synthetic-private-title', 'synthetic@example.invalid', '/synthetic/transcript.jsonl', '/synthetic/workspace', 'synthetic-session'];
const payload = {
  conversation_title: markers[0], email: markers[1], transcript_path: markers[2], cwd: markers[3], session_id: markers[4],
  quota: {
    'gemini-5h': { remaining_fraction: 0.75, reset_time: reset, reset_in_seconds: 3600, ignored: markers[0] },
    'claude-weekly': { remaining_amount: 200, reset_in_seconds: 7200 },
    disabled: { disabled: true, remaining_fraction: 0.5 },
  },
};
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-clock-agy-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const run = (args, input = JSON.stringify(payload)) => spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', input, env: { ...process.env, QUOTA_CLOCK_HOME: home, CODEX_HOME: path.join(home, 'missing-codex') },
  });
  return { home, file: path.join(home, ANTIGRAVITY_FILE), run };
}

test('Antigravity statusline persists only allowlisted quota fields and capture time', t => {
  const { home, file } = fixture(t);
  const result = writeAntigravityStatusline(JSON.stringify(payload), { home, now });
  assert.match(result.summary, /gemini-5h 25%/);
  assert.match(result.summary, /claude-weekly \?%/);
  assert.match(result.summary, /disabled disabled/);
  const raw = fs.readFileSync(file, 'utf8');
  const saved = JSON.parse(raw);
  assert.deepEqual(Object.keys(saved).sort(), ['version', 'fetchedAt', 'quota'].sort());
  assert.equal(saved.fetchedAt, now.toISOString());
  assert.equal(saved.quota['gemini-5h'].reset_time, '2026-11-14T14:00:00.000Z');
  assert.equal(saved.quota['claude-weekly'].reset_time, '2026-11-14T15:00:00.000Z');
  assert.equal(saved.quota['claude-weekly'].remaining_amount, 200);
  for (const marker of markers) {
    assert.ok(!raw.includes(marker));
    assert.ok(!JSON.stringify(result).includes(marker));
  }
  assert.ok(!raw.includes('ignored'));
  assert.deepEqual(fs.readdirSync(home), [ANTIGRAVITY_FILE]);
});

test('collector retains bucket names, unknown usage and non-periodic reset timestamps', async t => {
  const { home } = fixture(t);
  writeAntigravityStatusline(JSON.stringify(payload), { home, now });
  const rows = await collect({ collectors: [antigravityCollector], home, now });
  assert.deepEqual(rows, [
    { service: 'antigravity', window: 'gemini-5h', resetAt: '2026-11-14T14:00:00.000Z', periodMinutes: null, usedPercent: 25, source: 'antigravity-statusline', fetchedAt: now.toISOString(), note: '' },
    { service: 'antigravity', window: 'claude-weekly', resetAt: '2026-11-14T15:00:00.000Z', periodMinutes: null, usedPercent: null, source: 'antigravity-statusline', fetchedAt: now.toISOString(), note: '' },
  ]);
  const clock = createClock({ home, now: new Date('2026-11-15T00:00:00Z') });
  await clock.sync({ collectors: [antigravityCollector] });
  assert.ok(clock.list().every(row => row.remainingMs === 0));
  assert.equal(readAntigravityRecords({ home })[1].resetAt, rows[1].resetAt);
  for (const marker of markers) assert.ok(!fs.readFileSync(path.join(home, 'data.json'), 'utf8').includes(marker));
});

test('fractions at endpoints, decimals and invalid or absent fractions behave correctly', t => {
  const { home } = fixture(t);
  for (const [fraction, expected] of [[0, 100], [1, 0], [0.9378, 6.22], [-1, null], [2, null], ['0.5', null], [null, null], [undefined, null]]) {
    writeAntigravityStatusline(JSON.stringify({ quota: { weekly: { remaining_fraction: fraction, reset_time: reset } } }), { home, now });
    const row = readAntigravityRecords({ home })[0];
    assert.equal(row.usedPercent, expected);
    assert.equal(row.window, 'weekly');
    assert.equal(row.periodMinutes, null);
  }
});

test('invalid input and missing quotas leave previous cache intact', t => {
  const { home, file } = fixture(t);
  for (const input of ['', '{ bad JSON', 'null', '[]', '{}', '{"quota":[]}', '{"quota":{"bad":null}}']) {
    assert.equal(writeAntigravityStatusline(input, { home, now }).quota, null);
    assert.equal(fs.existsSync(file), false);
  }
  writeAntigravityStatusline(JSON.stringify(payload), { home, now });
  const before = fs.readFileSync(file, 'utf8');
  writeAntigravityStatusline('{"quota":{}}', { home, now });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.throws(() => writeAntigravityStatusline('{}', { home, now: 'invalid' }), /timestamp/);
});

test('reset timestamps are validated, absolute time wins, and invalid metadata is discarded', () => {
  const quota = extractAntigravityQuota({ quota: {
    absolute: { reset_time: '2026-11-14T23:00:00+09:00', reset_in_seconds: 1, remaining_fraction: 0.5, extra: markers[0] },
    relative: { reset_time: 'bad', reset_in_seconds: 0 },
    bad: { reset_time: 'bad', reset_in_seconds: -1 },
    overflow: { reset_in_seconds: 1e99 },
    string: { reset_in_seconds: '60' },
    '': { reset_time: reset },
    array: [],
  } }, { now });
  assert.deepEqual(Object.keys(quota), ['absolute', 'relative']);
  assert.equal(quota.absolute.reset_time, '2026-11-14T14:00:00.000Z');
  assert.equal(quota.relative.reset_time, now.toISOString());
  assert.ok(!JSON.stringify(quota).includes(markers[0]));
});

test('missing cache returns no records and corrupt cache errors do not echo content', t => {
  const { home, file } = fixture(t);
  assert.deepEqual(readAntigravityRecords({ home }), []);
  fs.writeFileSync(file, `{${markers[0]}`);
  assert.throws(() => readAntigravityRecords({ home }), error => /not valid JSON/.test(error.message) && !error.message.includes(markers[0]));
  assert.equal(fs.readFileSync(file, 'utf8'), `{${markers[0]}`);
});

test('CLI antigravity source, passive default sync and JSON work with synthetic stdin', t => {
  const { run } = fixture(t);
  const written = run(['statusline', '--source', 'antigravity']);
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stdout, /antigravity gemini-5h 25%/);
  for (const marker of markers) assert.ok(!written.stdout.includes(marker));
  const synced = run(['sync']);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /Synced 2 quota window/);
  const listed = run(['list', '--json']);
  const rows = JSON.parse(listed.stdout);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.service === 'antigravity' && row.source === 'antigravity-statusline'));
  assert.ok(rows.some(row => row.usedPercent === null));
  for (const marker of markers) assert.ok(!listed.stdout.includes(marker));
  const invalid = run(['statusline', '--source', 'unknown']);
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /Unknown statusline source/);
});

test('explicit Antigravity chaining forwards stdin and prints only the chosen command output', t => {
  const { home, run, file } = fixture(t);
  const helper = path.join(home, 'chain.mjs');
  fs.writeFileSync(helper, 'import fs from "node:fs"; const d = JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(d.quota && d.email ? "custom-line\\n" : "bad\\n");');
  const result = run(['statusline', '--source', 'antigravity', '--chain', `"${process.execPath}" "${helper}"`]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'custom-line\n');
  const saved = fs.readFileSync(file, 'utf8');
  for (const marker of markers) assert.ok(!saved.includes(marker));
});
