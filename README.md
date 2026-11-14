# quota-clock

[日本語 (Japanese)](./README.ja.md)

A zero-dependency Node.js CLI and library to record AI service quota reset times (such as 5-hour and weekly windows for Claude, Codex, etc.) and see when each service becomes available next, sorted by remaining wait time.

## Features

- Track multiple AI services and quota windows (`5h`, `weekly`, or custom window names)
- Flexible reset time input: relative durations (`155m`, `2h30m`, `3d`, `+155`), local clock times (`00:50`, `13:05`), or ISO 8601 timestamps
- Automatic roll-forward calculation for periodic windows (`5h` = 300 min, `weekly` = 10080 min, or custom `--period`)
- Local JSON storage with zero external dependencies (Node.js 20+)

## Installation

From a source checkout (no dependency installation needed):

```bash
node bin/quota-clock.mjs help
npm test
```

To register the local checkout as `quota-clock`, run `npm link`.

Install globally via npm:

```bash
npm i -g quota-clock
```

Or run directly with `npx`:

```bash
npx quota-clock help
```

## CLI Usage

```text
quota-clock set <service> <window> <when> [--used percent] [--note text] [--period minutes]
quota-clock list [--json]
quota-clock sync
quota-clock rm <service> [window]
quota-clock help
```

`list` shows service, window, next reset in local time, remaining wait, and note. An expired non-repeating window shows `今使える` (available now). Repeating windows roll forward to their next reset. `list --json` returns the library entries with ISO timestamps and remaining milliseconds.

### `<when>` formats

- Relative duration: `155m`, `2h30m`, `3d`, `+155` (in minutes)
- Local clock time (`HH:MM`): `00:50`, `13:05` (next occurrence today or tomorrow)
- ISO 8601 timestamp: e.g., `2026-11-14T15:00:00Z`

### Built-in window periods

- `5h`: defaults to a 300-minute (5-hour) repeating cycle
- `weekly`: defaults to a 10080-minute (7-day) repeating cycle
- Any custom window name can be used (optionally with `--period <minutes>`)

### Examples

```bash
# Record Claude's 5-hour quota resetting in 2 hours 35 minutes
quota-clock set claude 5h 2h35m --note "Opus heavy session"

# Record Codex's weekly quota resetting in 155 minutes, with a note
quota-clock set codex weekly 155m --note "20% left"

# Record a reset at local time 00:50
quota-clock set claude 5h 00:50

# List all tracked windows sorted by shortest remaining time
quota-clock list

# Output as JSON
quota-clock list --json

# Remove a specific window or an entire service
quota-clock rm claude 5h
quota-clock rm codex
```

## Data Storage Location

Data is stored locally in `data.json` inside the configuration directory resolved in the following order:

1. `QUOTA_CLOCK_HOME` environment variable (if set)
2. Windows: `%APPDATA%\quota-clock`
3. Linux / macOS: `$XDG_CONFIG_HOME/quota-clock` (or `~/.config/quota-clock`)

## Library API

```js
import { createClock } from 'quota-clock';

const clock = createClock({
  // Optional: custom storage directory and clock function
  // home: '/path/to/dir',
  // now: () => new Date(),
});

// Record a quota window reset
clock.set('claude', '5h', '155m', {
  note: 'almost full',
  // periodMinutes: 300, // defaults to 300 for '5h' and 10080 for 'weekly'
});

// List entries sorted by shortest remaining time
const entries = clock.list();
// => [{ service: 'claude', window: '5h', nextResetAt: '...', remainingMs: 9300000, note: 'almost full' }]

// Remove a single window or all windows for a service
clock.remove('claude', '5h');
clock.remove('claude');
```

## Usage metadata and collection API

Record a manual usage percentage with `quota-clock set claude 5h 155m --used 42.5`.
`--used` accepts 0 through 100, including fractions. Omit it for unknown usage.
The table also shows Used, Source, and Fetched (local time); missing values appear as `-`.
JSON entries include `usedPercent` (number or null), `source` (string), and `fetchedAt` (ISO timestamp or null).
Old records remain readable with unknown usage/time and source `manual`. Percentages are stored snapshots and do not reset automatically when a repeating reset time rolls forward.

`quota-clock sync` runs registered collectors and saves their results. The built-in `codex-session` collector reads quota snapshots from `${CODEX_HOME:-~/.codex}/sessions/YYYY/MM/DD/rollout-*.jsonl` (at most the final 256 KiB per file). Missing sessions produce no records and leave storage unchanged. See [data sources](docs/sources.md) for freshness, privacy, and other service availability.
External tools can pass their own collectors to the public API without accessing the CLI:

```js
import { collect, createClock } from 'quota-clock';

const demo = {
  name: 'demo',
  async collect({ now }) {
    // Synthetic example; replace with a quota-only source.
    return [{ service: 'demo', window: '5h',
      resetAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      usedPercent: 42, note: 'example' }];
  },
};
const records = await collect({ collectors: [demo] });
await createClock().sync({ records });
// Or: await createClock().sync({ collectors: [demo] });
```

A collector is a function or an object with a `collect({ now: Date })` method, returning an array (or promise of an array) of `{ service, window, resetAt, periodMinutes?, usedPercent?, source?, fetchedAt?, note? }`.
`collect({ collectors, now })` defaults source to the collector name and fetchedAt to the collection time; `now` may be a date or function returning a date.
`clock.sync` also accepts a records array directly. It validates the entire batch before one save; collection/validation errors propagate without partial updates. Unrelated windows remain unchanged.
`clock.set` accepts these same metadata options: usage defaults to null, source to `manual`, and fetchedAt to the clock time. Explicit null fetchedAt means unknown. New fields are additive within storage version 1.

## License

MIT
