*English · [עברית](README.he.md)*

# telegram-notify MCP

A small, **send-only** MCP server that lets Claude (or any MCP client) send **Telegram notifications to you**: a scheduled job finished, a long build failed, a reminder came due.

- **One fixed recipient.** The chat is set in configuration. No tool takes a chat id, so the model cannot send anywhere else.
- **Never polls.** It calls `sendMessage`, `sendDocument` and `getMe`, and never `getUpdates`. The same bot can keep serving another tool that polls it (for example the Claude Code Telegram channel plugin) with no `409 Conflict`, and nothing expires after 24 hours.
- **Two tools**, no Telegram library, two runtime dependencies (the MCP SDK and zod).

## Tools

| Tool | What it does |
|---|---|
| `notify` | Sends `text` to your chat. Plain text by default; `format: "markdown"` turns `**bold**`, `_italic_`, `` `code` ``, code blocks, `[links](https://…)` and `# headings` into Telegram HTML, with everything else escaped. Over 4096 characters it is split into several messages. `silent: true` delivers without a sound |
| `notify_file` | Sends a file (up to 50 MB) with an optional caption, **only from one folder you allow** (`TELEGRAM_NOTIFY_FILES_DIR`). Paths are resolved to their real location first, so `..` and symlinks cannot reach outside it. Without that variable every call is refused |

The tools are one-way: replies you type in Telegram never come back to the model.

## Setup

**1. A bot.** In Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token. An existing bot works too, even one another tool already polls.

**2. Your chat id.** Open a chat with your bot and press **Start** (a bot may only message people who started it). Then get your numeric id from a bot such as [@userinfobot](https://t.me/userinfobot). A group's id is negative; a channel can be given as `@channelname` once the bot is an admin there.

**3. Save it**, either way:

```bash
npx -y @yybd/telegram-notify-mcp setup
```

This asks for the token (hidden) and the chat id, checks the token, writes `~/.telegram-notify/config.json` with `600` permissions and sends a test message. Add `--files-dir <folder>` to allow `notify_file`. `TELEGRAM_NOTIFY_HOME` moves the folder.

Or pass environment variables to the server, which override the file:

| Variable | |
|---|---|
| `TELEGRAM_BOT_TOKEN` | required |
| `TELEGRAM_CHAT_ID` | required; the only recipient |
| `TELEGRAM_NOTIFY_FILES_DIR` | optional; the only folder `notify_file` may read. Unset = file sending off |

Check it any time:

```bash
npx -y @yybd/telegram-notify-mcp test
```

## Connect your clients

### Claude Code

**Recommended:** run `setup` first (see above), then add the server with no secrets on the command line:

```bash
claude mcp add telegram-notify -s user -- npx -y @yybd/telegram-notify-mcp
```

The token then stays in `~/.telegram-notify/config.json` (mode `600`) and out of `~/.claude.json`.

**Or with environment variables** instead of `setup`. Replace the example values with yours and keep the quotes. Don't type angle brackets such as `<token>`: the shell reads `<` as "read from a file" and the command fails with `no such file or directory`.

```bash
claude mcp add telegram-notify -s user -e TELEGRAM_BOT_TOKEN="123456789:AAExampleTokenFromBotFather" -e TELEGRAM_CHAT_ID="987654321" -- npx -y @yybd/telegram-notify-mcp
```

This stores the token in `~/.claude.json`.

New sessions pick up the server; one that is already open doesn't.

To send without a permission prompt each time, allow the tool in `~/.claude/settings.json`: `"permissions": { "allow": ["mcp__telegram-notify__notify"] }`. That is safe because of the fixed recipient: the worst a confused model can do is message you.

### Claude Desktop

**One click (recommended):** download `telegram-notify-<version>.mcpb` from the [latest release](https://github.com/yybd/telegram-notify-mcp/releases/latest) and double-click it, or drag it onto **Settings → Extensions** in Claude Desktop. Desktop asks for the bot token (stored as a secret), the chat id and, optionally, the folder for files, then installs it. Nothing else is needed: Desktop runs the extension with its own Node.js, and you don't need `setup`.

**Or by hand:** in `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "telegram-notify": {
      "command": "npx",
      "args": ["-y", "@yybd/telegram-notify-mcp"]
    }
  }
}
```

Add `"env": { "TELEGRAM_BOT_TOKEN": "…", "TELEGRAM_CHAT_ID": "…" }` if you didn't run `setup`. Then restart Claude Desktop. If it can't find `npx`, use its full path (`which npx`).

## How it compares

Checked on 2026-11-07 against each project's source code, with star counts from that day.

| Option | Recipient | Reads updates (`getUpdates`) | Shares a bot with a poller | Tools | Files |
|---|---|---|---|---|---|
| **telegram-notify (this)** | fixed in config; no tool parameter | **never** | yes | 2 | one allowed folder, symlink-safe; off by default |
| [ParthJadhav/telegram-notify-mcp](https://github.com/ParthJadhav/telegram-notify-mcp) (7 ⭐) | found by username in `getUpdates` | yes, on every process start | no | 3 | any local path |
| [aahl/mcp-notify](https://github.com/aahl/mcp-notify) (29 ⭐) | `TELEGRAM_DEFAULT_CHAT`, but every Telegram tool takes a `chat_id` the model can override | no | yes | 20+ (Telegram, WeCom, Home Assistant, others) | by URL |
| [antonio-castellon/mcp-telegram-bridge](https://github.com/antonio-castellon/mcp-telegram-bridge) (0 ⭐) | `chat_id` per call | yes, a `telegram_get_updates` tool | no | 6 | no |
| Official Claude channel plugins (Telegram) | whoever pairs | yes, continuously | it *is* the poller | — | yes |

**Why that matters:**
- **ParthJadhav/telegram-notify-mcp** is the closest in shape, but it learns your chat id from `getUpdates` each time it starts. Telegram keeps updates for only 24 hours, so a day after you last messaged the bot, it can no longer find you. Its `getUpdates` call also fails with `409 Conflict` while another process polls the same bot.
- **aahl/mcp-notify** works with a default chat, but the model may pass any `chat_id`, and it registers about twenty tools across many platforms.
- **mcp-telegram-bridge** is two-way by design: it reads inbound messages, so it cannot be send-only and has the same polling conflict.
- **Channel plugins** poll the bot to receive messages and belong to the one session that runs them; they are not a way for every session and client to notify you.

**What telegram-notify gives you:** a fixed recipient, no polling, one bot shared with your other tools, two tools, and file sending confined to one folder. What it deliberately doesn't do: receive messages, ask you questions and wait for answers, or send to anyone else.

## Security notes

- The token is never logged, and it is removed from every error message before it reaches the model or your terminal.
- `config.json` is written with `600` permissions.
- The server writes nothing to stdout except the MCP protocol, and talks to `api.telegram.org` only.

## Development

```bash
npm test
```

The tests run offline, with `fetch` mocked. They check that `getUpdates` is never called, that a smuggled `chat_id` is ignored, that the file sandbox rejects `..`, absolute paths and symlinks, that the token is redacted from errors, and that long text is split.

`./scripts/pack-mcpb.sh` builds the Claude Desktop extension, `telegram-notify-<version>.mcpb`, from `manifest.json`, `dist/` and the production dependencies.

**Layout:**
- `src/config.ts` — environment and config file
- `src/telegram.ts` — Bot API calls, Markdown → HTML, splitting, the file sandbox
- `src/server.ts` — the two tools
- `src/cli.ts` — `setup` and `test`
- `src/main.ts` — the command the package installs

## License

MIT
