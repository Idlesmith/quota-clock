import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createClock, collect, claudeCodeCollector } from '../src/index.mjs';
import { CLAUDE_CODE_FILE, writeClaudeCodeStatusline, readClaudeCodeRecords } from '../src/collectors/claude-code.mjs';

const cli = fileURLToPath(new URL('../bin/quota-clock.mjs', import.meta.url));
const baseNow = new Date('2026-11-14T12:00:00Z');
const fiveHourResetSec = Math.floor(new Date('2026-11-14T14:35:00Z').getTime() / 1000);
const sevenDayResetSec = Math.floor(new Date('2026-11-18T12:00:00Z').getTime() / 1000);

const syntheticStatuslinePayload = {
  cwd: '/synthetic/secret/workspace',
  session_id: 'synthetic-session-id-do-not-save',
  transcript_path: '/synthetic/secret/transcript.jsonl',
  model: { id: 'claude-opus-4-6', display_name: 'Opus' },
  rate_limits: {
    five_hour: {
      used_percentage: 23.5,
      resets_at: fiveHourResetSec,
    },
    seven_day: {
      used_percentage: 41.2,
      resets_at: sevenDayResetSec,
    },
    spend_limit: {
      used_percentage: 62.8,
      resets_at: sevenDayResetSec,
      used_usd: 100,
      limit_usd: 500,
    },
  },
};

function makeTempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-clock-claude-code-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

test('writeClaudeCodeStatusline stores only rate_limits (five_hour & seven_day) and strips sensitive fields', t => {
  const home = makeTempHome(t);
  const { rateLimits, summary } = writeClaudeCodeStatusline(JSON.stringify(syntheticStatuslinePayload), {
    home,
    now: baseNow,
  });

  assert.deepEqual(rateLimits, {
    five_hour: { used_percentage: 23.5, resets_at: fiveHourResetSec },
    seven_day: { used_percentage: 41.2, resets_at: sevenDayResetSec },
  });
  assert.equal(summary, 'claude 5h 24% (2h 35m) | weekly 41% (4d)');

  const savedRaw = fs.readFileSync(path.join(home, CLAUDE_CODE_FILE), 'utf8');
  assert.ok(!savedRaw.includes('synthetic-session-id-do-not-save'));
  assert.ok(!savedRaw.includes('transcript.jsonl'));
  assert.ok(!savedRaw.includes('/synthetic/secret/workspace'));
  assert.ok(!savedRaw.includes('spend_limit'));

  const saved = JSON.parse(savedRaw);
  assert.deepEqual(Object.keys(saved).sort(), ['fetchedAt', 'rate_limits', 'version']);
  assert.equal(saved.fetchedAt, baseNow.toISOString());
});

test('claudeCodeCollector and clock.sync import saved claude-code.json records', async t => {
  const home = makeTempHome(t);
  writeClaudeCodeStatusline(JSON.stringify(syntheticStatuslinePayload), { home, now: baseNow });

  const records = await collect({ collectors: [claudeCodeCollector], home, now: baseNow });
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], {
    service: 'claude',
    window: '5h',
    resetAt: new Date(fiveHourResetSec * 1000).toISOString(),
    periodMinutes: 300,
    usedPercent: 23.5,
    source: 'claude-code',
    fetchedAt: baseNow.toISOString(),
    note: '',
  });
  assert.deepEqual(records[1], {
    service: 'claude',
    window: 'weekly',
    resetAt: new Date(sevenDayResetSec * 1000).toISOString(),
    periodMinutes: 10080,
    usedPercent: 41.2,
    source: 'claude-code',
    fetchedAt: baseNow.toISOString(),
    note: '',
  });

  const clock = createClock({ home, now: () => baseNow });
  const synced = await clock.sync();
  assert.equal(synced.length, 2);
  const listed = clock.list();
  assert.equal(listed.length, 2);
  assert.equal(listed[0].service, 'claude');
  assert.equal(listed[0].window, '5h');
  assert.equal(listed[0].usedPercent, 23.5);
  assert.equal(listed[0].source, 'claude-code');
  assert.equal(listed[1].window, 'weekly');
  assert.equal(listed[1].usedPercent, 41.2);
});

test('statusline without rate_limits does not overwrite existing claude-code.json', t => {
  const home = makeTempHome(t);
  writeClaudeCodeStatusline(JSON.stringify(syntheticStatuslinePayload), { home, now: baseNow });
  const before = fs.readFileSync(path.join(home, CLAUDE_CODE_FILE), 'utf8');

  const noLimits = writeClaudeCodeStatusline(JSON.stringify({ model: { display_name: 'Opus' } }), { home, now: baseNow });
  assert.equal(noLimits.rateLimits, null);
  assert.match(noLimits.summary, /waiting for rate_limits/);
  assert.equal(fs.readFileSync(path.join(home, CLAUDE_CODE_FILE), 'utf8'), before);
  assert.equal(readClaudeCodeRecords({ home }).length, 2);
});

test('CLI statusline and --chain forward stdin and allow CLI sync', t => {
  const home = makeTempHome(t);
  const env = { ...process.env, QUOTA_CLOCK_HOME: home };

  // 1. Direct statusline invocation
  const direct = spawnSync(process.execPath, [cli, 'statusline'], {
    input: JSON.stringify(syntheticStatuslinePayload),
    encoding: 'utf8',
    env,
  });
  assert.equal(direct.status, 0, direct.stderr);
  assert.match(direct.stdout, /^claude 5h 24% .* \| weekly 41%/);

  // 2. Chained statusline invocation: forwards stdin to the chained command and prints its stdout
  const helperScript = path.join(home, 'chain-helper.mjs');
  fs.writeFileSync(
    helperScript,
    'import fs from "node:fs"; const d = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(`CUSTOM:${d.model.display_name}:${d.rate_limits.five_hour.used_percentage}\\n`);'
  );
  const chainCmd = `"${process.execPath}" "${helperScript}"`;
  const chained = spawnSync(process.execPath, [cli, 'statusline', '--chain', chainCmd], {
    input: JSON.stringify(syntheticStatuslinePayload),
    encoding: 'utf8',
    env,
  });
  assert.equal(chained.status, 0, chained.stderr);
  assert.equal(chained.stdout, 'CUSTOM:Opus:23.5\n');

  // 3. CLI sync imports the saved claude-code.json into data.json
  const syncRes = spawnSync(process.execPath, [cli, 'sync'], { encoding: 'utf8', env });
  assert.equal(syncRes.status, 0, syncRes.stderr);
  assert.match(syncRes.stdout, /Synced 2 quota window\(s\)\./);

  const listRes = spawnSync(process.execPath, [cli, 'list', '--json'], { encoding: 'utf8', env });
  assert.equal(listRes.status, 0, listRes.stderr);
  const rows = JSON.parse(listRes.stdout);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => `${r.service}/${r.window}:${r.usedPercent}:${r.source}`), [
    'claude/5h:23.5:claude-code',
    'claude/weekly:41.2:claude-code',
  ]);
});
