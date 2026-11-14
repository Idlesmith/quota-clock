import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWhen, nextReset, formatRemaining } from '../src/time.mjs';

const now = new Date(2026, 10, 14, 22, 0, 0); // local 2026-11-14 22:00
const plus = min => now.getTime() + min * 60_000;

test('relative forms', () => {
  assert.equal(parseWhen('155m', now).getTime(), plus(155));
  assert.equal(parseWhen('2h30m', now).getTime(), plus(150));
  assert.equal(parseWhen('3d', now).getTime(), plus(3 * 1440));
  assert.equal(parseWhen('+155', now).getTime(), plus(155));
  assert.equal(parseWhen('1D2H', now).getTime(), plus(1560));
});

test('time of day: later today or tomorrow', () => {
  const later = parseWhen('23:30', now);
  assert.deepEqual([later.getDate(), later.getHours(), later.getMinutes()], [14, 23, 30]);
  const tomorrow = parseWhen('00:50', now);
  assert.deepEqual([tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()], [15, 0, 50]);
  assert.equal(parseWhen('22:00', now).getDate(), 15, 'exactly now rolls to tomorrow');
});

test('ISO dates', () => {
  assert.equal(parseWhen('2026-11-20T09:00:00Z', now).toISOString(), '2026-11-20T09:00:00.000Z');
});

test('invalid input gives a clear error', () => {
  for (const bad of ['', 'soon', '25:00', '12:61', '10x', '2026-13-45']) {
    assert.throws(() => parseWhen(bad, now), /time/i, bad);
  }
});

test('nextReset rolls periodic windows forward', () => {
  assert.equal(nextReset(new Date(plus(-20)), 300, now).getTime(), plus(280));
  assert.equal(nextReset(new Date(plus(-600)), 300, now).getTime(), plus(300), 'exact boundary goes to the next period');
  assert.equal(nextReset(new Date(plus(10)), 300, now).getTime(), plus(10));
  assert.equal(nextReset(new Date(plus(-20)), null, now).getTime(), plus(-20), 'non-periodic stays in the past');
});

test('formatRemaining', () => {
  assert.equal(formatRemaining(0), 'now');
  assert.equal(formatRemaining(155 * 60_000), '2h 35m');
  assert.equal(formatRemaining(30_000), '1m');
  assert.equal(formatRemaining((1440 + 60) * 60_000), '1d 1h');
});
