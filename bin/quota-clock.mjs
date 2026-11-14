#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createClock } from '../src/index.mjs';

const usage = `Usage:
  quota-clock set <service> <window> <when> [--note text] [--period minutes]
  quota-clock list [--json]
  quota-clock rm <service> [window]
  quota-clock help

Times: 155m, 2h30m, 3d, +155, HH:MM (local), or ISO 8601.
Periods: 5h defaults to 300 minutes; weekly defaults to 10080 minutes.
Custom windows do not repeat unless --period is provided.`;

// Keep each record on one line even when names or notes contain control characters.
const cell = value => String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');

function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  const options = {
    set: { note: { type: 'string' }, period: { type: 'string' } },
    list: { json: { type: 'boolean' } },
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
  if (command === 'set') {
    requireArgs(3, 3);
    const entry = clock.set(...positionals, { note: values.note, periodMinutes: values.period });
    console.log(`Saved ${cell(entry.service)}/${cell(entry.window)}: ${new Date(entry.resetAt).toLocaleString()}`);
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
      ['Service', 'Window', 'Next reset (local)', 'Remaining', 'Note'],
      ...rows.map(row => [row.service, row.window, new Date(row.nextResetAt).toLocaleString(), row.remainingMs === 0 ? '今使える' : row.remaining, row.note]),
    ].map(row => row.map(cell));
    const widths = table[0].map((_, i) => Math.max(...table.map(row => [...row[i]].length)));
    console.log(table.map(row => row.map((value, i) => value + ' '.repeat(widths[i] - [...value].length)).join('  ').trimEnd()).join('\n'));
  }
}

try {
  main();
} catch (error) {
  console.error(`quota-clock: ${error.message}`);
  process.exitCode = 1;
}
