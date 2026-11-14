# Quota data sources

The built-in collectors are `codex-session`, `claude-code`, and the opt-in cache importer `antigravity-statusline`. Local-source investigation was recorded in IdleShift T-360 on 2026-11-14. Collector tests use synthetic fixtures, not real conversation content.

| Application | Source | Current behavior | Limits |
| --- | --- | --- | --- |
| Codex | ${CODEX_HOME:-~/.codex}/sessions/YYYY/MM/DD/rollout-*.jsonl | Reads bounded conversation-file tails and retains only quota snapshots | The buffer can contain conversation bytes. Snapshots may be stale or span accounts. |
| Claude Code | Explicit statusline export in `<home>/claude-code.json` | Imports the dedicated quota cache | Requires user statusline setup; freshness depends on updates. |
| Claude desktop | No usable quota cache found in the investigated app-data directories | Manual entry or app/AI self-report | In-app usage capability is not exposed as a local-file collector here. |
| Antigravity | Explicit statusline export in `<home>/antigravity.json` | Passive `antigravity-statusline` cache import after user setup | Synthetic-tested; live app payload compatibility unverified. No app/model launch. |

## Codex selection and privacy boundary

`codex-session` uses non-empty `CODEX_HOME`, otherwise `~/.codex`. The source home is independent of `QUOTA_CLOCK_HOME` / the clock's storage `home`. Direct library users can supply `codexCollector.collect({ codexHome })` using the exported collector for a synthetic or alternate source.

The collector enumerates date-shaped session directories and regular `rollout-*.jsonl` files, skipping nested file/directory symlinks. It tries files in descending modification-time order, reads at most the final **256 KiB per file**, discards a partial first line, and scans backwards for the last usable `event_msg` / `token_count` quota snapshot. Files with no usable snapshot are skipped. It does not merge different snapshots and does not scan `archived_sessions`.

**These are conversation-record files. Reading their tails brings conversation bytes into the process buffer.** Filtering occurs after that read. Only the quota fields below are returned or persisted; raw lines, conversation text, cwd/workspace paths, session/account IDs, token totals, credits, and unrelated payload fields are discarded. The collector never opens `auth.json`, credential stores, or other application files and makes no network requests. It does not send prompts or consume model tokens.

| Input | Output |
| --- | --- |
| primary / secondary used_percent | usedPercent (finite 0–100) |
| window_minutes | periodMinutes; 300 -> window 5h, 10080 -> weekly, otherwise `<n>m` |
| resets_at (Unix epoch seconds) | resetAt (ISO timestamp) |
| Event timestamp | fetchedAt (original observation time, not sync time) |
| Collector identity | service codex, source codex-session |

Malformed or partial lines and invalid quota entries are skipped. Missing sessions return no records and do not delete saved windows. Other I/O errors propagate. An event outside the tail limit is not found; the collector does not read the full history to recover it. The reader was previously removed during review under a strict prohibition on reading conversation bytes; this implementation restores the explicitly bounded extraction approach and documents its actual read boundary.

Modification time chooses which file to try first; it does not prove that its quota snapshot is newer than every event in every file. Account switching can make a source directory ambiguous because the collector does not read credentials or identify the authenticated account. Percentages remain snapshots when periodic reset times roll forward: compare fetchedAt with the present before relying on them.

## Claude Code statusline integration

`quota-clock statusline` receives the app-provided stdin JSON and writes only `rate_limits.five_hour` / `rate_limits.seven_day` and fetchedAt to `<home>/claude-code.json`. The built-in collector imports this cache during sync. It does not open transcript paths or authentication stores. See the [README setup](../README.md#claude-code-statusline-integration) and [official statusline documentation](https://code.claude.com/docs/en/statusline). Optional --chain forwards the original stdin to a user-chosen command, which therefore receives the original metadata; only extracted limits enter the quota cache.

## Other local-source findings

T-360 reported no usable usage cache in %APPDATA%/Claude or %LOCALAPPDATA%/Packages/Claude_*/LocalCache/Roaming/Claude. An in-app get_usage capability was reported, but no standalone local-file collector is provided for it. Reading OAuth tokens to query a private endpoint is excluded because it requires credentials. The investigation reported quota-related Antigravity state keys without numeric usage; those files are not parsed. Later public-interface research follows below.

Manual fallback (synthetic example):

```bash
quota-clock set codex 5h 155m --used 42 --note "reported by app"
```

## Antigravity statusline integration (T-372)

The optional `quota-clock statusline --source antigravity` command receives the full app-provided stdin JSON, then retains only validated quota fields plus a capture timestamp in `<home>/antigravity.json`. Conversation title, email, transcript path, and other surrounding metadata are discarded rather than written to files or logs. No transcript path is opened. See the [README configuration](../README.md#antigravity-statusline-integration) and [official statusline schema](https://antigravity.google/docs/cli/statusline/). Explicit --chain forwards the original full input to the user's command; that command is outside the cache filter.

The importer preserves bucket IDs as windows, sets periodMinutes to null, and computes usedPercent only from a finite remaining_fraction in [0,1]. remaining_amount does not establish a percentage. reset_time takes precedence; otherwise a non-negative numeric reset_in_seconds is resolved once at capture time. Disabled buckets are omitted from sync, missing reset values cannot form clock records, and missing/invalid quota input does not overwrite the cache. Sync does not delete previously imported windows that later disappear or become disabled.

Only the dedicated cache is read. No agy process, prompt, private API, credential file, app setting change, or live payload capture is part of this integration. The implementation is covered by synthetic tests, while installed-app behavior remains unverified. Historical T-371 findings below describe the earlier research before this opt-in importer was added; its standalone print-mode prohibition remains in effect.

## Antigravity CLI investigation (historical T-371)

Investigated 2026-11-14 for IdleShift T-371, using the installed `agy` 1.5.0 on Windows. This is a constrained research result, **not an implemented Antigravity collector**. No model turn, authentication request, session creation, quota request, credential-file read, conversation read, or package installation was performed in this task.

### Findings

| Candidate | Result | Consequence for quota-clock |
| --- | --- | --- |
| Standalone CLI usage command | `agy --help` does not list a usage/quota subcommand. The task reports prior negative results for `agy models` and `agy agentapi`; these were not repeated. | No verified standalone command to integrate. |
| ACP initialization | An `initialize` request returned protocol version 1, server version 1.5.0, and capabilities listed below. No quota/usage capability or extension was advertised. | Do not invent or probe private method names. Initialization alone supplies no quota values. |
| Interactive `/usage` | Official documentation describes a quota panel that refreshes data through the application. No interactive agent session was started. | Potential Windows ConPTY integration, not a validated dependency-free Node collector. |
| Print `/usage` | Official release notes claim non-agent handling, but the task reports a previous run instead invoked a model and consumed quota. | Unresolved discrepancy. The task explicitly forbids retrying it, so it was neither run nor integrated. |
| Statusline stdin | Official documentation describes a `quota` map with remaining values and reset times. | Promising opt-in export path, not an independently triggered one-shot query; see privacy and validation limits below. |

### Safe commands run

- `agy --help` (help returned exit status 1)
- `agy --version` (1.5.0)
- `agy acp --help`
- `agy changelog --help`
- `agy changelog` (exit status 0; public release notes only)

A short-lived `agy acp --disable-telemetry --log-file NUL` subprocess received exactly this JSON-RPC request on stdin:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"quota-clock-research","version":"0.1"}}}
```

The response identified `Antigravity ACP Server`, version `1.5.0`. Advertised features included session loading/resuming/closing/listing/additional directories, image and embedded-context prompts, logout, and Antigravity-specific tier/system-prompt metadata. It contained no usage values or advertised quota retrieval method. The subprocess was stopped after this response. No `authenticate`, `session/new`, `session/load`, `session/list`, or `session/prompt` request was sent. In particular, no existing conversation was loaded. This only establishes what initialization advertises, not the absence of every conceivable extension. ACP capability negotiation is described in the [official initialization specification](https://agentclientprotocol.com/protocol/v1/initialization).

### Print-mode contradiction

The [official changelog](https://raw.githubusercontent.com/google-antigravity/antigravity-cli/main/CHANGELOG.md), under 1.1.11, says read-only slash commands gained non-interactive structured output without agent turns. Later entries discuss timezone handling for usage output. `agy changelog` also returned release notes mentioning these features. Release notes can describe releases other than the installed version and do not prove the behavior of a specific invocation.

The task's prior observation reports that print-mode usage was treated as a prompt and spent quota. No new evidence in this task resolves that conflict. Accordingly, **quota-clock must not call print-mode `/usage` under the present task authorization**. Updating the CLI or trying alternate print flags was not attempted. Any future reevaluation needs explicit authorization and a vendor-supported way to establish non-agent dispatch before a usage invocation; a timeout after sending a prompt cannot guarantee that no quota was consumed.

### Interactive Windows feasibility

The [official usage guide](https://antigravity.google/docs/cli/commands/usage/) documents the interactive `/usage` / `/quota` panel and refreshing its quota data. The task allowed a feasibility assessment, not a requirement to build a terminal host.

A Windows host could technically create a ConPTY, launch the interactive CLI, enter the built-in command, and interpret its terminal output. [Microsoft's pseudoconsole guide](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session) describes native setup of communication channels, `CreatePseudoConsole`, and process startup. Plain `child_process` pipes do not supply an interactive terminal. The project's Node.js 20+ baseline does not include a supported core ConPTY host API; [`node:tty`](https://nodejs.org/download/release/v20.19.0/docs/api/tty.html) provides streams around existing terminal descriptors.

A maintained platform-specific native/PInvoke helper, or a PTY dependency, would therefore be needed for a robust Windows implementation. No dependency was installed and no native helper was built here. Even with a host, startup must avoid resuming conversations, distinguish the built-in panel from prompts, handle terminal escapes and resizing, and prove that collection creates no model turn. This remains an unvalidated approach, so no TUI scraper was added.

### Statusline export candidate

The [official statusline documentation](https://antigravity.google/docs/cli/statusline/) describes a command receiving JSON on stdin, including a `quota` map. Buckets can expose `remaining_fraction` or `remaining_amount`, `reset_time`, `reset_in_seconds`, and `disabled`. A fraction could support `usedPercent = 100 * (1 - remaining_fraction)`; an absolute remaining amount alone is insufficient without a known capacity. Bucket-to-model-group/window mapping also needs verification.

The full statusline payload includes personal metadata such as conversation title, email, and transcript path. No live payload was captured and no user settings were changed. Under the requirement not to read conversation content, a future integration needs a clearly authorized, quota-only producer boundary; discarding personal fields after receiving a full payload does not establish that they were never read. No statusline importer is claimed or enabled for Antigravity by this task. Its refresh behavior and schema have not been validated against this installed CLI.

### Boundary and available fallback

No `~/.gemini/antigravity/daemon/hub_*.json`, credential stores, tokens, app databases, or private authenticated endpoints were opened. No model-prompt flags were invoked. The investigation supplies no validated automatic Antigravity source meeting all present constraints, so `src/collectors/antigravity.mjs` was not added. Existing collection behavior is unchanged.

Until a safe route is established, manually copy the app's displayed values:

```bash
quota-clock set antigravity 5h 155m --used 42 --note "reported by app"
```

The numbers are synthetic. Separate model groups should use distinct service/window names to avoid conflating independent quota buckets. Manual entry records the entry time, which may differ from when the app fetched its numbers.
