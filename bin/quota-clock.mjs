#!/usr/bin/env node
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { createClock } from '../src/index.mjs';
import { writeClaudeCodeStatusline, runStatuslineChain } from '../src/collectors/claude-code.mjs';
import { writeAntigravityStatusline } from '../src/collectors/antigravity.mjs';

const usage = `Usage:
  quota-clock set <service> <window> <when> [--used percent] [--note text] [--period minutes]
  quota-clock list [--json]
  quota-clock sync
  quota-clock statusline [--source claude-code|antigravity] [--chain <command>]
  quota-clock rm <service> [window]
  quota-clock help

Times: 155m, 2h30m, 3d, +155, HH:MM (local), or ISO 8601.
Periods: 5h defaults to 300 minutes; weekly defaults to 10080 minutes.
Custom windows do not repeat unless --period is provided.`;

// Keep each record on one line even when names or notes contain control characters.
const cell = value => String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  const options = {
    set: { used: { type: 'string' }, note: { type: 'string' }, period: { type: 'string' } },
    list: { json: { type: 'boolean' } },
    sync: {},
    statusline: { source: { type: 'string' }, chain: { type: 'string' } },
    rm: {},
    help: {},
  };
  if (!Object.hasOwn(options, command)) throw new Error(`Unknown command: ${command}. Run quota-clock help.`);
  const { values, positionals } = parseArgs({ args, options: options[command], allowPositionals: true, strict: true });
  const requireArgs = (min, max) => {
    if (positionals.length < min || positionals.length > max) throw new Error(`Invalid arguments for ${command}.\n${usage}`);
  };
  if (command === 'help') {
    requireArgs(0, 0);
    console.log(usage);
    return;
  }
  const clock = createClock();
  if (command === 'statusline') {
    requireArgs(0, 0);
    if (values.chain !== undefined && !values.chain.trim()) throw new Error('--chain requires a non-empty command.');
    const writers = { 'claude-code': writeClaudeCodeStatusline, antigravity: writeAntigravityStatusline };
    const source = values.source ?? 'claude-code';
    if (!Object.hasOwn(writers, source)) throw new Error('Unknown statusline source. Use claude-code or antigravity.');
    const rawInput = fs.readFileSync(0, 'utf8');
    const { summary } = writers[source](rawInput, { home: clock.home });
    if (values.chain !== undefined) {
      process.stdout.write(runStatuslineChain(values.chain, rawInput));
    } else {
      console.log(summary);
    }
    return;
  }
  if (command === 'set') {
    requireArgs(3, 3);
    if (values.used !== undefined && !values.used.trim()) throw new Error('--used must be a number between 0 and 100.');
    const entry = clock.set(...positionals, { note: values.note, periodMinutes: values.period, usedPercent: values.used === undefined ? undefined : Number(values.used) });
    console.log(`Saved ${cell(entry.service)}/${cell(entry.window)}: ${new Date(entry.resetAt).toLocaleString()}`);
  } else if (command === 'sync') {
    requireArgs(0, 0);
    const updated = await clock.sync();
    console.log(updated.length ? `Synced ${updated.length} quota window(s).` : 'No quota records collected.');
  } else if (command === 'rm') {
    requireArgs(1, 2);
    const removed = clock.remove(...positionals);
    console.log(removed ? 'Removed.' : 'No matching entry.');
  } else {
    requireArgs(0, 0);
    const rows = clock.list();
    if (values.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (!rows.length) {
      console.log('No quota windows recorded.');
      return;
    }
    const table = [
      ['Service', 'Window', 'Next reset (local)', 'Remaining', 'Note', 'Used', 'Source', 'Fetched (local)'],
      ...rows.map(row => [row.service, row.window, new Date(row.nextResetAt).toLocaleString(), row.remainingMs === 0 ? '今使える' : row.remaining, row.note, row.usedPercent === null ? '-' : `${Math.round(row.usedPercent)}%`, row.source, row.fetchedAt === null ? '-' : new Date(row.fetchedAt).toLocaleString()]),
    ].map(row => row.map(cell));
    const widths = table[0].map((_, i) => Math.max(...table.map(row => [...row[i]].length)));
    console.log(table.map(row => row.map((value, i) => value + ' '.repeat(widths[i] - [...value].length)).join('  ').trimEnd()).join('\n'));
  }
}

try {
  await main();
} catch (error) {
  console.error(`quota-clock: ${error.message}`);
  process.exitCode = 1;
}
