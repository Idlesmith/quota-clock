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
quota-clock statusline [--source claude-code|antigravity] [--chain <command>]
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

`quota-clock sync` runs the built-in collectors: `codex-session` reads the final 256 KiB of Codex conversation-record files, while `claude-code` imports its quota-only statusline cache as described below. The Codex file tails can contain conversation bytes, but only quota fields are returned or saved; raw lines, conversation text, workspace paths, and credentials are never output or persisted. Codex source files are found under `${CODEX_HOME:-~/.codex}/sessions/YYYY/MM/DD/rollout-*.jsonl`. The passive `antigravity-statusline` collector imports a cache only after you configure the app as described below. See [data sources](docs/sources.md) for selection rules, freshness, and limits.

### Claude Code `statusLine` integration

Claude Code passes session state JSON via `stdin` to a custom status line command, including `rate_limits.five_hour` and `rate_limits.seven_day` (`used_percentage` and `resets_at`).
`quota-clock statusline` reads `stdin`, saves **only** `rate_limits` to `<home>/claude-code.json` (never storing conversation paths, transcripts, or credentials), and prints a compact status line summary. Then `quota-clock sync` imports those windows via the built-in `claude-code` collector.

Add to `~/.claude/settings.json` (quota-clock never modifies `settings.json` automatically):

```json
{
  "statusLine": {
    "type": "command",
    "command": "quota-clock statusline"
  }
}
```

If you already have a status line script, use `--chain` to forward the original `stdin` JSON to your command and print its output unchanged:

```json
{
  "statusLine": {
    "type": "command",
    "command": "quota-clock statusline --chain \"~/.claude/my-statusline.sh\""
  }
}
```

### Antigravity `statusLine` integration

Configure your own `~/.gemini/antigravity-cli/settings.json` to opt in (quota-clock never edits it):

```json
{
  "statusLine": {
    "type": "command",
    "command": "quota-clock statusline --source antigravity"
  }
}
```

The command **receives the full statusline JSON**, including any personal metadata supplied by the app, but saves only allowlisted `quota` bucket fields and `fetchedAt` in `<home>/antigravity.json`. It never opens the transcript path. Then run `quota-clock sync` to import that cache; sync launches no app or model. To retain a custom status line, append `--chain "your-command"`; this deliberately forwards the original full JSON to your command and displays its output. Without `--source`, statusline retains its Claude Code behavior.

Buckets become window names unchanged, with no assumed period. A valid `remaining_fraction` becomes `100 * (1 - fraction)` percent used; an absolute `remaining_amount` alone leaves usage unknown. Reset times come from `reset_time`, or from `reset_in_seconds` anchored to capture time. Disabled buckets are cached but omitted from sync. Missing/invalid quota input leaves the previous cache intact; skipped buckets do not erase previously saved clock entries. Capture time describes this stored snapshot, not a fresh quota query. This integration has synthetic-fixture coverage; live app setup/schema compatibility has not been tested here. See the [source notes](docs/sources.md).

External tools can also pass their own collectors to the public API without accessing the CLI:

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

## How this project was built

quota-clock was planned, implemented and reviewed by several AI assistants (Claude, Codex, Gemini/Antigravity) working together through [IdleShift](https://github.com/Idlesmith/idleShift), a local blackboard that hands out tasks, isolates each task in its own git worktree and has a different AI review every change. A human approved permissions and merges. IdleShift also bundles quota-clock's collectors to show each AI's remaining usage.

## License

MIT
