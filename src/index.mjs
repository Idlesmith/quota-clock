import { parseWhen, nextReset, formatRemaining } from './time.mjs';
import { defaultHome, load, save, DEFAULT_PERIODS } from './store.mjs';
import { collect, collectors, claudeCodeCollector, codexCollector, antigravityCollector } from './collectors/index.mjs';

export { parseWhen, nextReset, formatRemaining, defaultHome, DEFAULT_PERIODS, collect, collectors, claudeCodeCollector, codexCollector, antigravityCollector };

const name = (value, what) => {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${what} is required.`);
  return result;
};

function normalize(service, window, when, options, now) {
  const svc = name(service, 'Service');
  const win = name(window, 'Window');
  const { note = '', periodMinutes, usedPercent = null, source = 'manual', fetchedAt = now.toISOString() } = options;
  const period = periodMinutes === undefined ? (DEFAULT_PERIODS[win] ?? null)
    : periodMinutes === null ? null : Number(periodMinutes);
  if (period !== null && !(Number.isFinite(period) && period > 0)) throw new Error(`Invalid period: ${periodMinutes}`);
  if (usedPercent !== null && !(typeof usedPercent === 'number' && Number.isFinite(usedPercent) && usedPercent >= 0 && usedPercent <= 100)) {
    throw new Error('usedPercent must be a number between 0 and 100, or null.');
  }
  if (typeof source !== 'string' || !source.trim()) throw new Error('source must be a non-empty string.');
  if (fetchedAt !== null && (typeof fetchedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(fetchedAt) || Number.isNaN(Date.parse(fetchedAt)))) {
    throw new Error('fetchedAt must be an ISO timestamp or null.');
  }
  return { service: svc, window: win, resetAt: parseWhen(when, now).toISOString(), periodMinutes: period,
    note: String(note ?? ''), usedPercent, source, fetchedAt: fetchedAt === null ? null : new Date(fetchedAt).toISOString() };
}

function put(data, record) {
  const { service, window, ...value } = record;
  // Own properties allow arbitrary service/window names without inherited collisions.
  if (!Object.hasOwn(data.services, service)) Object.defineProperty(data.services, service, { value: { windows: {} }, enumerable: true, writable: true, configurable: true });
  const entry = data.services[service];
  entry.windows ??= {};
  Object.defineProperty(entry.windows, window, { value, enumerable: true, writable: true, configurable: true });
}

export function createClock({ home = defaultHome(), now = () => new Date() } = {}) {
  const nowDate = () => new Date(typeof now === 'function' ? now() : now);
  return {
    home,
    set(service, window, when, options = {}) {
      const record = normalize(service, window, when, options, nowDate());
      const data = load(home);
      put(data, record);
      save(home, data);
      return record;
    },

    // Accept collector implementations, { records: await collect(...) }, or a result array.
    // Validate the entire batch before a single atomic save so failures leave storage intact.
    async sync(options = {}) {
      const at = options.now === undefined ? nowDate() : new Date(typeof options.now === 'function' ? options.now() : options.now);
      if (Number.isNaN(at.getTime())) throw new Error('Invalid collection time.');
      const records = Array.isArray(options) ? options : options.records ?? await collect({ collectors: options.collectors, now: at, home });
      if (!Array.isArray(records)) throw new Error('records must be an array.');
      const normalized = records.map(record => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid collector record.');
        return normalize(record.service, record.window, record.resetAt, record, at);
      });
      if (!normalized.length) return [];
      const data = load(home);
      for (const record of normalized) put(data, record);
      save(home, data);
      return normalized;
    },

    remove(service, window) {
      const svc = name(service, 'Service');
      const data = load(home);
      if (!Object.hasOwn(data.services, svc)) return false;
      if (window === undefined || window === null || window === '') delete data.services[svc];
      else {
        if (!Object.hasOwn(data.services[svc].windows ?? {}, window)) return false;
        delete data.services[svc].windows[window];
        if (!Object.keys(data.services[svc].windows).length) delete data.services[svc];
      }
      save(home, data);
      return true;
    },

    list() {
      const n = nowDate();
      const rows = [];
      for (const [service, s] of Object.entries(load(home).services)) {
        for (const [window, w] of Object.entries(s.windows || {})) {
          const next = nextReset(w.resetAt, w.periodMinutes, n);
          const remainingMs = Math.max(0, next.getTime() - n.getTime());
          rows.push({ service, window, nextResetAt: next.toISOString(), remainingMs, remaining: formatRemaining(remainingMs), note: w.note || '',
            usedPercent: w.usedPercent ?? null, source: w.source ?? 'manual', fetchedAt: w.fetchedAt ?? null });
        }
      }
      return rows.sort((a, b) => a.remainingMs - b.remainingMs || a.service.localeCompare(b.service) || a.window.localeCompare(b.window));
    }
  };
}
