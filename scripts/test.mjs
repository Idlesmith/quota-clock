// Runs every tests/*.test.mjs with node --test.
// Node 20 does not expand glob patterns for --test, and a bare directory fails on Windows,
// so the file list is built here.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = readdirSync('tests').filter(f => f.endsWith('.test.mjs')).sort().map(f => join('tests', f));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
