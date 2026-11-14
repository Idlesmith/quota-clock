# Quota data sources

Local-source investigation: 2026-11-14 (IdleShift task T-360). These are findings from the investigated installations, not a vendor-supported API contract. The Codex implementation is tested with synthetic data only; this task did not inspect real sessions, credentials, or conversation content.

| Application | Available source | Current approach | Reliability / limits |
| --- | --- | --- | --- |
| Codex | `${CODEX_HOME:-~/.codex}/sessions/YYYY/MM/DD/rollout-*.jsonl`, quota snapshots in `event_msg` / `token_count` events | Automatic built-in `codex-session` collector | Recorded service-provided snapshots, not a live query. Format may change, and freshness depends on session activity. |
| Claude desktop | No usable quota cache found in the investigated app-data directories | Manual `set --used`, or an app/AI reporting its usage | The investigation reported an in-app `get_usage` capability returning `percentUsed` and `resetsAt`; it is not exposed as a local-file collector here. |
| Claude Code | No dedicated quota file found in the investigated `~/.claude` directories | Manual entry; optional statusline export is a candidate | Some statusline input versions may expose `rate_limits`; this was unverified in T-360. Conversation logs containing usage text are not an authoritative quota source. |
| Antigravity | No numeric usage snapshot found in the investigated local files | Manual `set --used` | State keys mentioning quota refresh are not usage values. |

## Codex format and selection

The collector uses `CODEX_HOME` when non-empty, otherwise the user's `~/.codex` directory. It enumerates only date-shaped session directories and regular `rollout-*.jsonl` files. Nested directory/file symlinks are not followed. It does not scan `archived_sessions`.

Files are tried in descending modification-time order. Each read is limited to the final **256 KiB**. A partial first line is discarded. Within the tail, the last valid quota event wins; a file without a usable event is skipped in favor of the next file. There is no merge across snapshots or files.

The JSONL event shape used by the collector is:

```json
{
  "timestamp": "2026-11-14T13:00:00Z",
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "rate_limits": {
      "primary": { "used_percent": 25, "window_minutes": 300, "resets_at": 1794664800 },
      "secondary": { "used_percent": 75, "window_minutes": 10080, "resets_at": 1794668400 }
    }
  }
}
```

All values above are synthetic examples. The collector maps each valid `primary` / `secondary` object to:

| Input | Output |
| --- | --- |
| `used_percent` | `usedPercent` (finite number, 0–100) |
| `window_minutes` | `periodMinutes`; `300` -> window `5h`, `10080` -> `weekly`, otherwise `<n>m` |
| `resets_at` (Unix epoch seconds) | `resetAt` (ISO timestamp) |
| Event `timestamp` | `fetchedAt` (ISO timestamp; original observation time, not sync time) |
| Collector identity | service `codex`, source `codex-session` |

Invalid windows, malformed JSON, partial trailing lines, and non-quota events are skipped. Missing session folders or no usable snapshots return an empty array (not detected), without deleting saved entries. Other I/O errors propagate to the caller. If no quota event fits in the tail, that file is skipped instead of reading its whole history.

Usage remains a snapshot even if `list` rolls a periodic reset forward. Compare `fetchedAt` with the present before relying on a percentage. The collector does not identify the currently authenticated account, so a directory containing sessions from multiple accounts is ambiguous.

## Privacy boundary and rejected approaches

Only quota records are returned and persisted. The reader necessarily fetches bounded file-tail bytes that can contain unrelated JSONL lines; it filters for quota-event markers before parsing, ignores conversation events, and never logs or saves raw lines. Token totals, credits, account identifiers, file paths, and all other payload fields are discarded. It never opens `auth.json` or other credential stores and makes no network requests.

The Claude desktop investigation checked `%APPDATA%/Claude` and `%LOCALAPPDATA%/Packages/Claude_*/LocalCache/Roaming/Claude` and reported no usable on-disk usage snapshot. Claude Code's `~/.claude` files also supplied no dedicated usage cache. Reading OAuth tokens to query a private usage API was rejected because credentials are outside this project's collection boundary. A future opt-in statusline export can provide quota-only data without reading credentials or transcripts.

For Antigravity, the investigation reported quota-related keys in `~/.gemini/antigravity/antigravity_state.pbtxt` but no numeric snapshot, and no usage percentages in `antigravity-cli/cli.log`. Those files are not parsed by quota-clock.

Manual fallback:

```bash
quota-clock set claude 5h 155m --used 42 --note "reported by app"
quota-clock set antigravity weekly 3d --used 80
```
