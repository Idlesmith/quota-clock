import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../bin/quota-clock.mjs', import.meta.url));
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-clock-cli-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', env: { ...process.env, QUOTA_CLOCK_HOME: home, TZ: 'Asia/Tokyo' },
  });
  const ok = (...args) => {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return result.stdout;
  };
  return { home, run, ok, list: () => JSON.parse(ok('list', '--json')) };
}

test('help and an empty list work without creating storage', t => {
  const { home, ok, list } = fixture(t);
  assert.match(ok(), /quota-clock set/);
  assert.match(ok('help'), /--period minutes/);
  assert.match(ok('list'), /No quota windows/);
  assert.deepEqual(list(), []);
  assert.deepEqual(fs.readdirSync(home), []);
});

test('set persists notes, built-in periods and sorted JSON entries', t => {
  const { home, ok, list } = fixture(t);
  const before = Date.now();
  ok('set', 'claude', '5h', '2h35m', '--note', 'Opus heavy session');
  ok('set', 'codex', 'weekly', '155m', '--note', '20% left');
  ok('set', 'soon', 'custom', '+5');
  const after = Date.now();
  const rows = list();
  assert.equal(rows.length, 3);
  assert.equal(rows[0].service, 'soon');
  const claude = rows.find(row => row.service === 'claude');
  assert.equal(claude.note, 'Opus heavy session');
  assert.ok(Date.parse(claude.nextResetAt) >= before + 155 * 60_000);
  assert.ok(Date.parse(claude.nextResetAt) <= after + 155 * 60_000);
  assert.ok(rows.every((row, i) => i === 0 || rows[i - 1].remainingMs <= row.remainingMs));
  const data = JSON.parse(fs.readFileSync(path.join(home, 'data.json'), 'utf8'));
  assert.equal(data.services.claude.windows['5h'].periodMinutes, 300);
  assert.equal(data.services.codex.windows.weekly.periodMinutes, 10080);
  assert.equal(data.services.soon.windows.custom.periodMinutes, null);
});

test('list renders local timestamps, ready windows and sanitized notes in order', t => {
  const { ok } = fixture(t);
  ok('set', 'future', 'custom', '2099-01-02T00:00:00Z');
  ok('set', 'ready', 'custom', '2000-01-02T00:00:00Z', '--note', '残り20%\nnext\tline\u001b');
  const output = ok('list');
  assert.match(output, /Service\s+Window\s+Next reset \(local\)\s+Remaining\s+Note/);
  assert.match(output, /今使える/);
  assert.match(output, /残り20% next line/);
  assert.equal(output.split('\n').filter(Boolean).length, 3);
  assert.ok(output.indexOf('ready') < output.indexOf('future'));
  const expected = new Date('2000-01-02T00:00:00Z').toLocaleString(undefined, { timeZone: 'Asia/Tokyo' });
  assert.ok(output.includes(expected));
});

test('custom periodic resets roll forward; set updates an existing window', t => {
  const { home, ok, list } = fixture(t);
  ok('set', 'a', 'custom', '2000-01-01T00:00:00Z', '--period', '90', '--note', 'old');
  const row = list()[0];
  assert.ok(row.remainingMs > 0 && row.remainingMs <= 90 * 60_000);
  ok('set', 'a', 'custom', '1h', '--note', 'new');
  assert.equal(list().length, 1);
  assert.equal(list()[0].note, 'new');
  const data = JSON.parse(fs.readFileSync(path.join(home, 'data.json'), 'utf8'));
  assert.equal(data.services.a.windows.custom.periodMinutes, null);
});

test('README local time and relative formats are accepted', t => {
  const { ok, list } = fixture(t);
  for (const when of ['00:50', '13:05', '155m', '2h30m', '3d', '+155']) {
    ok('set', 'claude', '5h', when);
    assert.ok(list()[0].remainingMs > 0);
  }
});

test('rm removes one window or all windows and tolerates a missing entry', t => {
  const { ok, list } = fixture(t);
  ok('set', 'claude', '5h', '1h');
  ok('set', 'claude', 'weekly', '3d');
  ok('set', 'codex', 'weekly', '155m');
  assert.match(ok('rm', 'claude', '5h'), /Removed/);
  assert.deepEqual(list().map(row => `${row.service}/${row.window}`), ['codex/weekly', 'claude/weekly']);
  ok('rm', 'claude');
  ok('rm', 'codex');
  assert.deepEqual(list(), []);
  assert.match(ok('rm', 'absent'), /No matching entry/);
});

test('invalid commands, arity, options, times and periods fail without writing', t => {
  const { home, run } = fixture(t);
  for (const args of [
    ['unknown'], ['set', 'a', '5h'], ['set', 'a', '5h', '1h', 'extra'],
    ['rm'], ['rm', 'a', '5h', 'extra'], ['list', 'extra'], ['help', 'extra'],
    ['list', '--note', 'x'], ['rm', 'a', '--json'], ['set', 'a', '5h', '1h', '--note'],
    ['set', 'a', '5h', 'bad'], ['set', 'a', '5h', '1h', '--period', '0'],
    ['set', 'a', '5h', '1h', '--period', 'abc'], ['set', 'a', '5h', '1h', '--period', '-5'],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.match(result.stderr, /^quota-clock: /);
    assert.equal(result.stdout, '');
  }
  assert.deepEqual(fs.readdirSync(home), []);
});

test('corrupt storage reports an error and is preserved', t => {
  const { home, run } = fixture(t);
  const file = path.join(home, 'data.json');
  fs.writeFileSync(file, '{ broken');
  for (const args of [['list'], ['list', '--json'], ['set', 'a', '5h', '1h'], ['rm', 'a']]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not valid JSON/);
    assert.equal(result.stdout, '');
    assert.equal(fs.readFileSync(file, 'utf8'), '{ broken');
  }
});

test('--used is persisted and shown with source and collection time', t => {
  const { ok, list } = fixture(t);
  ok('set', 'demo', '5h', '1h', '--used', '42.5');
  const row = list()[0];
  assert.equal(row.usedPercent, 42.5);
  assert.equal(row.source, 'manual');
  assert.ok(Number.isFinite(Date.parse(row.fetchedAt)));
  const output = ok('list');
  assert.match(output, /Used\s+Source\s+Fetched \(local\)/);
  assert.match(output, /42\.5%\s+manual/);
  ok('set', 'demo', '5h', '1h', '--used', '0');
  assert.match(ok('list'), /0%\s+manual/);
  ok('set', 'demo', '5h', '1h', '--used', '100');
  assert.equal(list()[0].usedPercent, 100);
  ok('set', 'demo', '5h', '1h');
  assert.equal(list()[0].usedPercent, null);
  assert.match(ok('list'), /-\s+manual/);
});

test('invalid --used inputs fail without creating data', t => {
  const { home, run } = fixture(t);
  for (const value of ['-1', '101', 'NaN', 'Infinity', 'forty', '', ' ']) {
    const result = run('set', 'demo', '5h', '1h', '--used', value);
    assert.equal(result.status, 1, value);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /used|--used/);
  }
  assert.deepEqual(fs.readdirSync(home), []);
});

test('sync with no registered collectors reports no records and rejects extra args', t => {
  const { home, ok, run } = fixture(t);
  assert.match(ok('help'), /quota-clock sync/);
  assert.match(ok('sync'), /No quota records collected/);
  assert.deepEqual(fs.readdirSync(home), []);
  for (const args of [['sync', 'extra'], ['sync', '--used', '42']]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /quota-clock:/);
  }
});
