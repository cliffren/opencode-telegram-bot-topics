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
- `/schedule` menu for delayed and recurring tasks (fixed time, after delay, daily/weekly/monthly/yearly)
- `/bg` background task dispatch — run shell commands in the background without blocking the session, with Telegram notification on completion

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

### 2) Configure `.env`

Copy `.env.example` to `.env`. Required minimum:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USER_ID=...

OPENCODE_MODEL_PROVIDER=opencode
OPENCODE_MODEL_ID=big-pickle
```

OpenCode connection (defaults to `http://localhost:4096`):

```env
OPENCODE_API_URL=http://127.0.0.1:4096
OPENCODE_SERVER_USERNAME=opencode   # if auth is enabled
OPENCODE_SERVER_PASSWORD=...
```

Sendfile CLI discovery (recommended, run these to auto-detect):

macOS/Linux:

```bash
echo "SEND_FILE_CLI_BIN_DIR=$(npm prefix -g)/bin" >> .env
echo "SEND_FILE_CLI_COMMAND=opencode-telegram-topics-sendfile" >> .env
```

Windows PowerShell:

```powershell
Add-Content .env "SEND_FILE_CLI_BIN_DIR=$((npm prefix -g))"
Add-Content .env "SEND_FILE_CLI_COMMAND=opencode-telegram-topics-sendfile"
```

Voice transcription (optional):

```env
STT_API_URL=...
STT_API_KEY=...
STT_MODEL=...
STT_LANGUAGE=...
```

See `.env.example` for the full list of settings.

### 3) Build

```bash
npm run build
npm link
```

`npm link` is required for the sendfile CLI to be available globally. Verify:

```bash
command -v opencode-telegram-topics-sendfile
```

### 4) Start OpenCode server

```bash
opencode serve
```

### 5) Run the bot

```bash
node dist/cli.js start
```

### 6) Run as a background service (recommended)

#### macOS (LaunchAgent)

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

#### Linux (systemd user service)

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

#### Windows (NSSM)

```powershell
nssm install opencode-telegram-bot "C:\Program Files\nodejs\node.exe" "C:\path\to\opencode-telegram-bot-topics\dist\cli.js" start
nssm set opencode-telegram-bot AppDirectory "C:\path\to\opencode-telegram-bot-topics"
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
- `/schedule`
- `/bg`
- `/opencode_start`
- `/opencode_restart`
- `/opencode_stop`
- `/help`

### OpenCode server control commands

- `/opencode_start` starts `opencode serve --port <target-port>` if target port is not healthy.
- `/opencode_stop` stops only the managed process for that target port.
- `/opencode_restart` restarts only the managed process for that target port.

Target port is parsed from `OPENCODE_API_URL`. External OpenCode processes are detected but not force-stopped by the bot.

## Schedule Tasks (`/schedule`)

Use `/schedule` to open an interactive menu (no long command syntax needed).

Supported schedule types:

- Fixed time: `YYYY-MM-DD HH:mm`
- After delay: `<number>m` or `<number>h` (minutes/hours)
- Recurring:
  - Daily: `HH:mm`
  - Weekly: choose weekday in menu, then `HH:mm`
  - Monthly: `DD HH:mm`
  - Yearly: `MM-DD HH:mm`

Notes:

- Tasks are bound to the current chat/topic and current selected session.
- Timezone is the machine timezone where the bot process runs.
- Task list supports pagination in the inline menu.

## Background Tasks (`/bg`)

Send `/bg` in chat, describe the task, and the bot dispatches it as a detached background process without blocking the current session. A Telegram notification is sent on completion.

No extra installation needed — `npm run build` is sufficient, the notify CLI is located automatically by the bot.

### Usage

1. Send `/bg` and follow the inline menu to enter a task description and optional post-action.
2. The bot sends the task to the current OpenCode session.
3. The model runs the command in the background and confirms dispatch.
4. You receive a Telegram notification when the task finishes.

### Logs

Background task output is written to `<app_home>/logs/bg/<job-id>.log`.

### Optional env override

```env
OPENCODE_TELEGRAM_JOB_NOTIFY_BIN=/absolute/path/to/opencode-telegram-job-notify
```

## Terminal Sendfile CLI

Allows the model to send files to Telegram directly from the command line.

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

Model-side command guidance uses `SEND_FILE_CLI_COMMAND` and `SEND_FILE_CLI_BIN_DIR` (if set) to generate platform-specific command hints.

## Troubleshooting

### Bot says OpenCode server is unavailable

1. Is OpenCode running? Run `opencode serve`
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
