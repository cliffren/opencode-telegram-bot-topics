# OpenCode Telegram Bot Topics Edition

[![npm version](https://img.shields.io/npm/v/@cliffren/opencode-telegram-bot-topics)](https://www.npmjs.com/package/@cliffren/opencode-telegram-bot-topics)
[![CI](https://github.com/cliffren/opencode-telegram-bot-topics/actions/workflows/ci.yml/badge.svg)](https://github.com/cliffren/opencode-telegram-bot-topics/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

This repository is developed on top of the original OpenCode Telegram Bot and focuses on practical workflow upgrades for daily Telegram usage.

## Upstream base

This project is based on:

- [grinev/opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot)

Huge thanks to the original maintainers for the core architecture and feature foundation.

## What we updated

Compared to the upstream baseline, this fork adds and improves the following areas.

### 1) Topic/thread isolation

- Session selection is isolated by `chat + thread` scope
- Better separation between topics in Telegram forum/group workflows
- Reduced risk of context bleed between unrelated conversations

### 2) Session UX improvements

- Two-level `/sessions` menu:
  - Level 1: root sessions
  - Level 2: main session + sub-sessions
- Main session is clickable in the second-level menu
- Added `Back` and `Cancel` controls in sub-session menu
- Improved callback handling stability for nested session selection
- Added `/delete_sessions` flow with confirmation menu and cascade delete for main sessions

### 3) Thinking/tool status stream in one message

- Thinking and tool calls are shown in a single in-place updated status message
- Final model response replaces the status message when possible
- Compact one-line tool preview for mobile readability
- Added guards for late tool events after final response

### 4) Media and file handling upgrades

- Better handling of Telegram `document` messages as generic files
- Document flow is no longer forced into image-only prompt behavior
- Existing image flow remains supported
- Voice/audio transcription flow retained and integrated with prompt routing

### 5) Telegram usability additions

- Natural-language screenshot requests supported
- Natural-language send-file requests supported
- Inline file candidate selection when multiple paths match

### 6) Compatibility with oh-my-opencode ecosystem

- Improved agent/tool naming compatibility for oh-my-opencode style plugins and agent IDs
- Better handling for hyphenated/custom agent identifiers in Telegram callbacks
- Keeps tool/status rendering stable when extended toolchains are used

## Core capabilities (inherited + enhanced)

- Remote prompting to local OpenCode from Telegram
- Session/project/model/agent controls
- Inline question and permission workflows
- Pinned context/status updates
- Secure user allowlist with `TELEGRAM_ALLOWED_USER_ID`

## Quick start

1. Create bot token in `@BotFather`
2. Get your Telegram numeric user ID
3. Start OpenCode server:

```bash
opencode serve
```

4. Run bot (local repo):

```bash
cd /path/to/opencode-telegram-bot-topics
npm install
npm run build
node dist/cli.js start
```

Next runs (after build):

```bash
cd /path/to/opencode-telegram-bot-topics
node dist/cli.js start
```

Optional (npm package):

```bash
npx @cliffren/opencode-telegram-bot-topics
```

Optional (macOS LaunchAgent example):

```bash
launchctl kickstart -k gui/$(id -u)/com.opencode.telegram-bot-test
launchctl print gui/$(id -u)/com.opencode.telegram-bot-test
```

Linux (manual run):

```bash
cd /path/to/opencode-telegram-bot-topics
npm install
npm run build
node dist/cli.js start
```

Linux (systemd user service, optional):

```bash
systemctl --user restart opencode-telegram-bot
journalctl --user -u opencode-telegram-bot -f
```

Windows (manual run, PowerShell):

```powershell
cd C:\path\to\opencode-telegram-bot-topics
npm install
npm run build
node dist\cli.js start
```

Windows (service via NSSM, optional):

```powershell
nssm restart opencode-telegram-bot
nssm status opencode-telegram-bot
```

## Service setup examples

Linux (systemd user service, recommended):

1. Create service file: `~/.config/systemd/user/opencode-telegram-bot.service`

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

2. Reload and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now opencode-telegram-bot
```

3. Manage service:

```bash
systemctl --user restart opencode-telegram-bot
systemctl --user status opencode-telegram-bot
journalctl --user -u opencode-telegram-bot -f
```

Windows (service via NSSM, recommended):

1. Install service:

```powershell
nssm install opencode-telegram-bot "C:\Program Files\nodejs\node.exe" "C:\path\to\opencode-telegram-bot-topics\dist\cli.js" start
```

2. Set working directory:

```powershell
nssm set opencode-telegram-bot AppDirectory "C:\path\to\opencode-telegram-bot-topics"
```

3. Set environment variables (optional but recommended):

```powershell
nssm set opencode-telegram-bot AppEnvironmentExtra "OPENCODE_TELEGRAM_HOME=C:\Users\YourUser\AppData\Roaming\opencode-telegram-bot" "OPENCODE_TELEGRAM_RUNTIME_MODE=installed"
```

4. Start and enable auto-start:

```powershell
nssm start opencode-telegram-bot
nssm set opencode-telegram-bot Start SERVICE_AUTO_START
```

5. Manage service:

```powershell
nssm restart opencode-telegram-bot
nssm status opencode-telegram-bot
```

## Main commands

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
- `/help`

## Important config

See `.env.example` for full details. Commonly used variables:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_ID`
- `OPENCODE_API_URL`
- `OPENCODE_MODEL_PROVIDER`
- `OPENCODE_MODEL_ID`
- `BOT_LOCALE`
- `SESSIONS_LIST_LIMIT`
- `PROJECTS_LIST_LIMIT`
- `SERVICE_MESSAGES_INTERVAL_SEC`
- `HIDE_THINKING_MESSAGES`
- `HIDE_TOOL_CALL_MESSAGES`
- `HIDE_TOOL_FILE_MESSAGES`
- `CODE_FILE_MAX_SIZE_KB`

For voice/audio transcription:

- `STT_API_URL`
- `STT_API_KEY`
- `STT_MODEL`
- `STT_LANGUAGE`

## Development

```bash
npm run build
npm run lint
npm test
```
