# Quota sources: Antigravity CLI investigation

Investigated 2026-11-14 for IdleShift T-371, using the installed `agy` 1.5.0 on Windows. This is a constrained research result, **not an implemented Antigravity collector**. No model turn, authentication request, session creation, quota request, credential-file read, conversation read, or package installation was performed in this task.

## Findings

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

## Print-mode contradiction

The [official changelog](https://raw.githubusercontent.com/google-antigravity/antigravity-cli/main/CHANGELOG.md), under 1.1.11, says read-only slash commands gained non-interactive structured output without agent turns. Later entries discuss timezone handling for usage output. `agy changelog` also returned release notes mentioning these features. Release notes can describe releases other than the installed version and do not prove the behavior of a specific invocation.

The task's prior observation reports that print-mode usage was treated as a prompt and spent quota. No new evidence in this task resolves that conflict. Accordingly, **quota-clock must not call print-mode `/usage` under the present task authorization**. Updating the CLI or trying alternate print flags was not attempted. Any future reevaluation needs explicit authorization and a vendor-supported way to establish non-agent dispatch before a usage invocation; a timeout after sending a prompt cannot guarantee that no quota was consumed.

## Interactive Windows feasibility

The [official usage guide](https://antigravity.google/docs/cli/commands/usage/) documents the interactive `/usage` / `/quota` panel and refreshing its quota data. The task allowed a feasibility assessment, not a requirement to build a terminal host.

A Windows host could technically create a ConPTY, launch the interactive CLI, enter the built-in command, and interpret its terminal output. [Microsoft's pseudoconsole guide](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session) describes native setup of communication channels, `CreatePseudoConsole`, and process startup. Plain `child_process` pipes do not supply an interactive terminal. The project's Node.js 20+ baseline does not include a supported core ConPTY host API; [`node:tty`](https://nodejs.org/download/release/v20.19.0/docs/api/tty.html) provides streams around existing terminal descriptors.

A maintained platform-specific native/PInvoke helper, or a PTY dependency, would therefore be needed for a robust Windows implementation. No dependency was installed and no native helper was built here. Even with a host, startup must avoid resuming conversations, distinguish the built-in panel from prompts, handle terminal escapes and resizing, and prove that collection creates no model turn. This remains an unvalidated approach, so no TUI scraper was added.

## Statusline export candidate

The [official statusline documentation](https://antigravity.google/docs/cli/statusline/) describes a command receiving JSON on stdin, including a `quota` map. Buckets can expose `remaining_fraction` or `remaining_amount`, `reset_time`, `reset_in_seconds`, and `disabled`. A fraction could support `usedPercent = 100 * (1 - remaining_fraction)`; an absolute remaining amount alone is insufficient without a known capacity. Bucket-to-model-group/window mapping also needs verification.

The full statusline payload includes personal metadata such as conversation title, email, and transcript path. No live payload was captured and no user settings were changed. Under the requirement not to read conversation content, a future integration needs a clearly authorized, quota-only producer boundary; discarding personal fields after receiving a full payload does not establish that they were never read. No statusline importer is claimed or enabled for Antigravity by this task. Its refresh behavior and schema have not been validated against this installed CLI.

## Boundary and available fallback

No `~/.gemini/antigravity/daemon/hub_*.json`, credential stores, tokens, app databases, or private authenticated endpoints were opened. No model-prompt flags were invoked. The investigation supplies no validated automatic Antigravity source meeting all present constraints, so `src/collectors/antigravity.mjs` was not added. Existing collection behavior is unchanged.

Until a safe route is established, manually copy the app's displayed values:

```bash
quota-clock set antigravity 5h 155m --used 42 --note "reported by app"
```

The numbers are synthetic. Separate model groups should use distinct service/window names to avoid conflating independent quota buckets. Manual entry records the entry time, which may differ from when the app fetched its numbers.
