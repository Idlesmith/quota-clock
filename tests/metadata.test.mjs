import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collect, createClock } from '../src/index.mjs';

const now = new Date('2026-11-14T13:00:00Z');
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-clock-metadata-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, clock: createClock({ home, now: () => now }), file: path.join(home, 'data.json') };
}
const record = (overrides = {}) => ({ service: 'demo', window: '5h', resetAt: '2026-11-14T14:00:00Z', usedPercent: 42, source: 'fixture', ...overrides });

test('set persists metadata and supports zero, fractional and full usage', t => {
  const { clock, home, file } = fixture(t);
  for (const usedPercent of [0, 42.5, 100, null]) {
    const result = clock.set('demo', '5h', '1h', { usedPercent });
    assert.equal(result.usedPercent, usedPercent);
    assert.equal(result.source, 'manual');
    assert.equal(result.fetchedAt, now.toISOString());
    const row = createClock({ home, now }).list()[0];
    assert.equal(row.usedPercent, usedPercent);
    assert.equal(row.fetchedAt, now.toISOString());
    assert.equal(row.source, 'manual');
    assert.equal(JSON.parse(fs.readFileSync(file)).services.demo.windows['5h'].usedPercent, usedPercent);
  }
  clock.set('demo', '5h', '1h', { usedPercent: 15, source: 'fixture', fetchedAt: '2026-11-14T20:00:00+09:00' });
  assert.equal(clock.list()[0].fetchedAt, '2026-11-14T11:00:00.000Z');
  clock.set('demo', '5h', '1h', { fetchedAt: null });
  assert.equal(clock.list()[0].fetchedAt, null);
  assert.equal(clock.list()[0].usedPercent, null);
});

test('invalid usage and metadata cannot overwrite stored data', t => {
  const { clock, file } = fixture(t);
  clock.set('demo', '5h', '1h', { usedPercent: 50 });
  const before = fs.readFileSync(file, 'utf8');
  for (const usedPercent of [-1, 101, NaN, Infinity, '42', '', false, {}]) {
    assert.throws(() => clock.set('demo', '5h', '1h', { usedPercent }), /usedPercent/);
  }
  for (const source of ['', ' ', null, 42]) assert.throws(() => clock.set('demo', '5h', '1h', { source }), /source/);
  for (const fetchedAt of ['', 'yesterday', '2026-11-14', '2026-99-99T00:00:00Z', 42]) {
    assert.throws(() => clock.set('demo', '5h', '1h', { fetchedAt }), /fetchedAt/);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('v1 records remain readable and are preserved alongside new records', t => {
  const { clock, file } = fixture(t);
  const legacy = { resetAt: '2026-11-14T14:00:00Z', periodMinutes: 300, note: 'legacy' };
  fs.writeFileSync(file, JSON.stringify({ version: 1, services: { old: { windows: { '5h': legacy } } } }));
  assert.deepEqual(clock.list()[0], { service: 'old', window: '5h', nextResetAt: '2026-11-14T14:00:00.000Z', remainingMs: 3600000, remaining: '1h', note: 'legacy', usedPercent: null, source: 'manual', fetchedAt: null });
  clock.set('new', 'weekly', '3d', { usedPercent: 80 });
  const data = JSON.parse(fs.readFileSync(file));
  assert.equal(data.version, 1);
  assert.deepEqual(data.services.old.windows['5h'], legacy);
});

test('collect supports async functions and named objects without mutating records', async () => {
  const input = record({ fetchedAt: null });
  const object = {
    name: 'demo-collector',
    async collect({ now: at }) {
      assert.equal(this, object);
      assert.equal(at.toISOString(), now.toISOString());
      at.setFullYear(2000);
      return [{ service: 'another', window: 'weekly', resetAt: '2026-11-15T00:00:00Z' }];
    },
  };
  const rows = await collect({ collectors: [async () => [input], object], now: () => now });
  assert.deepEqual(rows[0], input);
  assert.equal(rows[1].source, 'demo-collector');
  assert.equal(rows[1].fetchedAt, now.toISOString());
  assert.equal(now.getUTCFullYear(), 2026);
  const anonymous = await collect({ collectors: [() => [record({ source: undefined })]], now });
  assert.equal(anonymous[0].source, 'collector');
  const { home: emptyHome } = fixture({ after: () => {} });
  try {
    assert.deepEqual(await collect({ now, home: emptyHome }), []);
  } finally {
    fs.rmSync(emptyHome, { recursive: true, force: true });
  }
});

test('sync imports batches once and updates only matching windows', async t => {
  const { clock, home } = fixture(t);
  clock.set('keep', 'weekly', '3d', { note: 'manual' });
  const results = await clock.sync({ collectors: [{ name: 'fixture', collect: async () => [record(), record({ window: 'weekly', periodMinutes: 45, usedPercent: 90 })] }] });
  assert.equal(results.length, 2);
  assert.equal(results[0].fetchedAt, now.toISOString());
  assert.equal(results[0].periodMinutes, 300);
  assert.equal(results[1].periodMinutes, 45);
  assert.equal(createClock({ home, now }).list().length, 3);
  await clock.sync({ records: [record({ usedPercent: 60, fetchedAt: null })] });
  assert.equal(clock.list().find(r => r.window === '5h').usedPercent, 60);
  assert.equal(clock.list().find(r => r.window === '5h').fetchedAt, null);
  const at = new Date('2026-11-14T13:30:00Z');
  await clock.sync({ records: [record()], now: () => at });
  assert.equal(clock.list().find(r => r.window === '5h').fetchedAt, at.toISOString());
  const collected = await collect({ collectors: [() => [record({ usedPercent: 75 })]], now });
  await clock.sync(collected);
  assert.equal(clock.list().find(r => r.window === '5h').usedPercent, 75);
  assert.equal(clock.list().find(r => r.service === 'keep').note, 'manual');
});

test('failed collection or validation leaves the entire stored batch unchanged', async t => {
  const { clock, file } = fixture(t);
  clock.set('existing', '5h', '1h');
  const before = fs.readFileSync(file, 'utf8');
  await assert.rejects(clock.sync({ records: [record(), record({ usedPercent: 101 })] }), /usedPercent/);
  await assert.rejects(clock.sync({ collectors: [() => [record()], () => { throw new Error('fixture failure'); }] }), /fixture failure/);
  await assert.rejects(clock.sync({ records: [record({ resetAt: 'invalid' })] }), /Cannot understand/);
  await assert.rejects(clock.sync({ records: {} }), /array/);
  await assert.rejects(clock.sync({ records: [null] }), /record/);
  await assert.rejects(clock.sync({ now: 'bad' }), /time/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('empty sync does not create storage and invalid collectors reject clearly', async t => {
  const { clock, file } = fixture(t);
  assert.deepEqual(await clock.sync(), []);
  assert.equal(fs.existsSync(file), false);
  for (const collectors of [{}, [null], [() => null], [() => [null]]]) {
    await assert.rejects(collect({ collectors }), /array|function|record/);
  }
  await assert.rejects(collect({ now: 'bad' }), /time/);
});
