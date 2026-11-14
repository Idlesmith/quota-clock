// Local JSON storage in the user's config directory. Writes are atomic (temp file + rename).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PERIODS = { '5h': 300, weekly: 10080 };

export function defaultHome(env = process.env, platform = process.platform) {
  if (env.QUOTA_CLOCK_HOME) return env.QUOTA_CLOCK_HOME;
  if (platform === 'win32' && env.APPDATA) return path.join(env.APPDATA, 'quota-clock');
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'quota-clock');
  return path.join(os.homedir(), '.config', 'quota-clock');
}

export const emptyData = () => ({ version: 1, services: {} });

export function load(home) {
  const file = path.join(home, 'data.json');
  if (!fs.existsSync(file)) return emptyData();
  const text = fs.readFileSync(file, 'utf8');
  let data;
  try { data = JSON.parse(text); } catch (e) {
    throw new Error(`${file} is not valid JSON (${e.message}). Fix or remove it; it was not overwritten.`);
  }
  if (!data || typeof data !== 'object' || typeof data.services !== 'object' || data.services === null) {
    throw new Error(`${file} has an unexpected shape. Fix or remove it; it was not overwritten.`);
  }
  return data;
}

export function save(home, data) {
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, 'data.json');
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
