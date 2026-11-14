import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClock } from '../src/index.mjs';
import { defaultHome } from '../src/store.mjs';

const tmpHome = t => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-clock-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const base = new Date('2026-11-14T13:00:00Z');

test('set, reload and list sorted by remaining time', t => {
  const home = tmpHome(t);
  const c = createClock({ home, now: () => base });
  c.set('codex', '5h', '155m', { note: 'weekly low' });
  c.set('claude', '5h', '50m');
  c.set('claude', 'weekly', '3d');
  const rows = createClock({ home, now: () => base }).list();
  assert.deepEqual(rows.map(r => `${r.service}/${r.window}`), ['claude/5h', 'codex/5h', 'claude/weekly']);
  assert.equal(rows[1].note, 'weekly low');
  assert.equal(rows[0].remaining, '50m');
  const data = JSON.parse(fs.readFileSync(path.join(home, 'data.json'), 'utf8'));
  assert.equal(data.version, 1);
  assert.equal(data.services.claude.windows['5h'].periodMinutes, 300);
  assert.equal(data.services.claude.windows.weekly.periodMinutes, 10080);
});

test('periodic window rolls forward after reset; custom window has no period', t => {
  let now = base;
  const c = createClock({ home: tmpHome(t), now: () => now });
  c.set('claude', '5h', '10m');
  c.set('agy', 'daily-ish', '10m');
  now = new Date(base.getTime() + 20 * 60_000);
  const rows = Object.fromEntries(c.list().map(r => [r.service, r]));
  assert.equal(rows.claude.remainingMs, 290 * 60_000);
  assert.equal(rows.agy.remainingMs, 0);
  assert.equal(rows.agy.remaining, 'now');
});

test('remove a window or a whole service', t => {
  const c = createClock({ home: tmpHome(t), now: () => base });
  c.set('a', '5h', '1h'); c.set('a', 'weekly', '1d'); c.set('b', '5h', '2h');
  assert.equal(c.remove('a', '5h'), true);
  assert.deepEqual(c.list().map(r => `${r.service}/${r.window}`), ['b/5h', 'a/weekly']);
  assert.equal(c.remove('b'), true);
  assert.equal(c.remove('zzz'), false);
  assert.equal(c.remove('a', 'nope'), false);
});

test('broken JSON is not overwritten', t => {
  const home = tmpHome(t);
  fs.writeFileSync(path.join(home, 'data.json'), '{ broken');
  const c = createClock({ home, now: () => base });
  assert.throws(() => c.set('a', '5h', '1h'), /not valid JSON/);
  assert.equal(fs.readFileSync(path.join(home, 'data.json'), 'utf8'), '{ broken');
});

test('validation errors', t => {
  const c = createClock({ home: tmpHome(t), now: () => base });
  assert.throws(() => c.set('', '5h', '1h'), /Service/);
  assert.throws(() => c.set('a', '5h', 'later'), /Cannot understand/);
  assert.throws(() => c.set('a', 'x', '1h', { periodMinutes: -5 }), /period/);
});

test('defaultHome order', () => {
  assert.equal(defaultHome({ QUOTA_CLOCK_HOME: '/q' }, 'linux'), '/q');
  assert.equal(defaultHome({ APPDATA: 'C:\\A' }, 'win32'), path.join('C:\\A', 'quota-clock'));
  assert.equal(defaultHome({ XDG_CONFIG_HOME: '/x' }, 'linux'), path.join('/x', 'quota-clock'));
  assert.equal(defaultHome({}, 'linux'), path.join(os.homedir(), '.config', 'quota-clock'));
});
