import { parseWhen, nextReset, formatRemaining } from './time.mjs';
import { defaultHome, load, save, DEFAULT_PERIODS } from './store.mjs';

export { parseWhen, nextReset, formatRemaining, defaultHome, DEFAULT_PERIODS };

export function createClock({ home = defaultHome(), now = () => new Date() } = {}) {
  const nowDate = () => (typeof now === 'function' ? now() : new Date(now));
  const name = (v, what) => {
    const s = String(v ?? '').trim();
    if (!s) throw new Error(`${what} is required.`);
    return s;
  };

  return {
    home,
    set(service, window, when, { note = '', periodMinutes } = {}) {
      const svc = name(service, 'Service');
      const win = name(window, 'Window');
      const at = parseWhen(when, nowDate());
      const period = periodMinutes === undefined ? (DEFAULT_PERIODS[win] ?? null)
        : periodMinutes === null ? null : Number(periodMinutes);
      if (period !== null && !(Number.isFinite(period) && period > 0)) throw new Error(`Invalid period: ${periodMinutes}`);
      const data = load(home);
      const entry = (data.services[svc] ??= { windows: {} });
      entry.windows ??= {};
      entry.windows[win] = { resetAt: at.toISOString(), periodMinutes: period, note: String(note ?? '') };
      save(home, data);
      return { service: svc, window: win, resetAt: at.toISOString(), periodMinutes: period };
    },

    remove(service, window) {
      const svc = name(service, 'Service');
      const data = load(home);
      if (!data.services[svc]) return false;
      if (window === undefined || window === null || window === '') delete data.services[svc];
      else {
        if (!data.services[svc].windows?.[window]) return false;
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
          rows.push({ service, window, nextResetAt: next.toISOString(), remainingMs, remaining: formatRemaining(remainingMs), note: w.note || '' });
        }
      }
      return rows.sort((a, b) => a.remainingMs - b.remainingMs || a.service.localeCompare(b.service) || a.window.localeCompare(b.window));
    }
  };
}
