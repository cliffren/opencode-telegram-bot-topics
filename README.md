# OpenCode Telegram Bot Topics

[![npm version](https://img.shields.io/npm/v/@cliffren/opencode-telegram-bot-topics)](https://www.npmjs.com/package/@cliffren/opencode-telegram-bot-topics)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

Telegram bot client for OpenCode. It lets you run and monitor coding tasks from Telegram chats/topics.

This project is based on [grinev/opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot), with additional workflow and session UX improvements.

## Highlights

- Topic/thread scoped session isolation (`chat + thread`)
- Per chat/topic scoped model and agent selection
- Compatible with oh-my-opencode style multi-agent switching
- Two-level `/sessions` menu (root -> main/sub-sessions)
- `/delete_sessions` with confirmation flow and cascade delete for main sessions
- In-place status stream (thinking/tool/final in one message)
- Better Telegram file/document handling for prompt input
- Voice/audio transcription support (Whisper-compatible API)

## Requirements

- Node.js 20+
- A Telegram bot token from `@BotFather`
- Your Telegram numeric user ID (allowlist)
- OpenCode server running (`opencode serve`)

## Quick Start

### 1) Clone and install

```bash
git clone https://github.com/cliffren/opencode-telegram-bot-topics.git
cd opencode-telegram-bot-topics
npm install
```

### 2) Create `.env`

Copy `.env.example` to `.env` and set required values.

Required minimum:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USER_ID=...

OPENCODE_MODEL_PROVIDER=opencode
OPENCODE_MODEL_ID=big-pickle
```

### 3) Start OpenCode server

```bash
opencode serve
```

### 4) Build and expose CLI commands globally (required)

```bash
npm run build
npm link
```

Verify sendfile command is available from any directory:

```bash
command -v opencode-telegram-topics-sendfile
opencode-telegram-topics-sendfile --help
```

### 5) Run the bot

```bash
node dist/cli.js start
```

## How Connection Works (OpenCode Port / Binding)

The bot connects to OpenCode via HTTP API URL:

- `OPENCODE_API_URL` (default: `http://localhost:4096`)

If your `opencode serve` runs on another port, set it explicitly:

```env
OPENCODE_API_URL=http://127.0.0.1:7777
```

If OpenCode server auth is enabled, also configure:

```env
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=your_password
```

So yes, port matters; it is bound through `OPENCODE_API_URL`.

## Configuration

See `.env.example` for the full list. Most important settings:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_ID`
- `OPENCODE_API_URL`
- `OPENCODE_SERVER_USERNAME`
- `OPENCODE_SERVER_PASSWORD`
- `OPENCODE_MODEL_PROVIDER`
- `OPENCODE_MODEL_ID`
- `SESSIONS_LIST_LIMIT`
- `PROJECTS_LIST_LIMIT`
- `BOT_LOCALE`
- `SERVICE_MESSAGES_INTERVAL_SEC`
- `HIDE_THINKING_MESSAGES`
- `HIDE_TOOL_CALL_MESSAGES`
- `HIDE_TOOL_FILE_MESSAGES`

Voice transcription (optional):

- `STT_API_URL`
- `STT_API_KEY`
- `STT_MODEL`
- `STT_LANGUAGE`

## Service Setup

Important: terminal `opencode-telegram-topics-sendfile` and bot service must share the same runtime values (`OPENCODE_TELEGRAM_RUNTIME_MODE`, `OPENCODE_TELEGRAM_HOME`) so they read/write the same sendfile queue.

### macOS (LaunchAgent)

Create `~/Library/LaunchAgents/com.opencode.telegram-bot.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.opencode.telegram-bot</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/opencode-telegram-bot-topics/dist/cli.js</string>
    <string>start</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/path/to/opencode-telegram-bot-topics</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>OPENCODE_TELEGRAM_RUNTIME_MODE</key>
    <string>installed</string>
    <key>OPENCODE_TELEGRAM_HOME</key>
    <string>/Users/youruser/Library/Application Support/opencode-telegram-bot</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/Users/youruser/Library/Logs/opencode-telegram-bot.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/youruser/Library/Logs/opencode-telegram-bot.log</string>
</dict>
</plist>
```

Load/restart/check:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.opencode.telegram-bot.plist
launchctl kickstart -k gui/$(id -u)/com.opencode.telegram-bot
launchctl print gui/$(id -u)/com.opencode.telegram-bot
```

### Linux (systemd user service)

Create `~/.config/systemd/user/opencode-telegram-bot.service`:

```ini
[Unit]
Description=OpenCode Telegram Bot
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/opencode-telegram-bot-topics
ExecStart=/usr/bin/node /path/to/opencode-telegram-bot-topics/dist/cli.js start
Restart=always
RestartSec=5
Environment=OPENCODE_TELEGRAM_HOME=/home/youruser/.local/share/opencode-telegram-bot
Environment=OPENCODE_TELEGRAM_RUNTIME_MODE=installed

[Install]
WantedBy=default.target
```

Enable and check:

```bash
systemctl --user daemon-reload
systemctl --user enable --now opencode-telegram-bot
systemctl --user status opencode-telegram-bot
journalctl --user -u opencode-telegram-bot -f
```

### Windows (NSSM)

```powershell
nssm install opencode-telegram-bot "C:\Program Files\nodejs\node.exe" "C:\path\to\opencode-telegram-bot-topics\dist\cli.js" start
nssm set opencode-telegram-bot AppDirectory "C:\path\to\opencode-telegram-bot-topics"
nssm set opencode-telegram-bot AppEnvironmentExtra "OPENCODE_TELEGRAM_HOME=C:\Users\YourUser\AppData\Roaming\opencode-telegram-bot" "OPENCODE_TELEGRAM_RUNTIME_MODE=installed"
nssm start opencode-telegram-bot
nssm status opencode-telegram-bot
```

## Main Commands

- `/status`
- `/new`
- `/stop`
- `/sessions`
- `/delete_sessions`
- `/projects`
- `/model`
- `/agent`
- `/rename`
- `/screenshot`
- `/sendfile`
- `/help`

## Terminal Sendfile CLI (for model-driven delivery)

If you want fully natural-language workflows where the model decides to send files by itself,
use the terminal queue CLI instead of relying only on `/sendfile` text commands.

Primary command:

```bash
opencode-telegram-topics-sendfile <file-path>
```

Compatibility alias:

```bash
opencode-telegram-sendfile <file-path>
```

Optional routing target:

```bash
opencode-telegram-topics-sendfile <file-path> --chat-id <id> --thread-id <id>
```

Important: the CLI writer and running bot must use the same runtime paths.
Keep these environment values aligned between terminal and service:

- `OPENCODE_TELEGRAM_RUNTIME_MODE`
- `OPENCODE_TELEGRAM_HOME`

Queue is consumed from `<app_home>/run/sendfile-requests` by default.

If you deploy from source, run `npm link` once during first setup so this command is globally available even when the current working directory is not the repository.

## Troubleshooting

### Bot says OpenCode server is unavailable

Check in order:

1. Is OpenCode running?
   - Run `opencode serve`
2. Does `OPENCODE_API_URL` match the actual host/port?
3. If auth is enabled, are `OPENCODE_SERVER_USERNAME/PASSWORD` correct?
4. If running across machines, is the API reachable through firewall/network?

### Sessions not showing as expected

- `/sessions` is project-scoped (current selected project)
- Increase `SESSIONS_LIST_LIMIT` if needed

### Telegram callbacks look stale

- Re-open the relevant menu (`/sessions`, `/delete_sessions`, `/projects`)
- Old inline messages can become inactive after state transitions

## Development

```bash
npm run build
npm run lint
npm test
```

## License

MIT. See `LICENSE`.
