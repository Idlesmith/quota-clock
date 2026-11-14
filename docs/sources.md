# Quota data sources

Local-source investigation: 2026-11-14 (IdleShift task T-360). These are reported findings from the investigated installations, not vendor-supported API contracts. This implementation task used synthetic fixtures only and did not inspect actual sessions, credentials, or conversation content.

**No built-in automatic collector is currently registered.** The collection API and manual usage tracking are available. Codex's identified on-disk source contains conversations, so reading it would violate the current requirement not to read conversation bodies. A bounded tail and discarding unrelated fields after reading do not satisfy that requirement.

| Application | Reported source / location | Current approach | Reliability / limits |
| --- | --- | --- | --- |
| Codex | `${CODEX_HOME:-~/.codex}/sessions/YYYY/MM/DD/rollout-*.jsonl` contains `token_count` quota snapshots alongside conversations | Manual `set --used`; rollout files are not read | Usage metadata exists, but it is not isolated from conversations. A quota-only export is needed for automatic collection. |
| Claude desktop | No usable quota cache found in the investigated app-data directories | Manual entry or an app/AI reporting its own usage | The investigation reported an in-app `get_usage` capability returning `percentUsed` and `resetsAt`; it is not a standalone local-file source. |
| Claude Code | No dedicated quota file found in the investigated `~/.claude` directories | Manual entry; optional quota-only statusline export is a candidate | Some statusline input versions may expose `rate_limits`; this was unverified in T-360. Conversation logs containing usage text are not a suitable source. |
| Antigravity | No numeric usage snapshot found in the investigated local files | Manual `set --used` | State keys mentioning quota refresh are not usage values. |

## Codex: identified format, unavailable under the privacy constraint

T-360 reported quota fields in the `rate_limits` object of `token_count` events:

| Reported field | Potential mapping in a future quota-only source |
| --- | --- |
| `primary.used_percent` / `secondary.used_percent` | `usedPercent` (0–100) |
| `window_minutes` | `periodMinutes`; 300 -> window `5h`, 10080 -> `weekly`, otherwise `<n>m` |
| `resets_at` (Unix epoch seconds) | `resetAt` (ISO timestamp) |
| Event `timestamp` | `fetchedAt` (the observation time, not import time) |

The same rollout files contain conversation records. A proposed implementation read the final 256 KiB and selected quota events; privacy review rejected it because the file read itself brought unrelated conversation bytes into memory. That reader and its default registration have been removed. The program does not enumerate or open Codex sessions or `auth.json`, even when `CODEX_HOME` is set and session files exist.

No alternative quota-only Codex source was established by the investigation. This task does not change the privacy constraint or enable collection through transcripts, credentials, or network requests. A future integration must receive a quota-only export from an authorized producer, rather than extracting it from mixed conversation files. Until then, `sync` with no registered collectors returns no records and leaves saved entries unchanged.

## Claude and Antigravity findings

The Claude desktop investigation checked `%APPDATA%/Claude` and `%LOCALAPPDATA%/Packages/Claude_*/LocalCache/Roaming/Claude` and reported no usable on-disk usage snapshot. Claude Code's `~/.claude` files supplied no dedicated usage cache. A conversation recording an app's usage response is still a conversation, not an approved collector source.

Reading OAuth tokens to query a private usage API was rejected because credentials are outside the collection boundary. A future opt-in statusline producer may export quota-only data without reading credentials or transcripts; its input schema and availability still need verification before claiming support.

For Antigravity, the investigation reported quota-related keys in `~/.gemini/antigravity/antigravity_state.pbtxt` but no numeric snapshot, and no usage percentages in `antigravity-cli/cli.log`. Those files are not parsed by quota-clock.

## Available fallback and freshness

Record the numbers and reset time shown by the app manually:

```bash
quota-clock set codex 5h 155m --used 42 --note "reported by app"
quota-clock set claude weekly 3d --used 80
quota-clock set antigravity weekly 3d --used 60
```

These are synthetic examples. `set` records source `manual` and the entry time as `fetchedAt`. Usage remains a snapshot even if `list` rolls a periodic reset time forward; a new reset does not automatically make an old percentage current.

External tools may use the public `collect({ collectors })` and `clock.sync({ records })` interfaces with explicitly supplied quota-only data. No built-in collector or source reader is enabled by those examples.
