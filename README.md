# OpenCode Telegram Bot (Based on Original Project)

[![npm version](https://img.shields.io/npm/v/@grinev/opencode-telegram-bot)](https://www.npmjs.com/package/@grinev/opencode-telegram-bot)
[![CI](https://github.com/grinev/opencode-telegram-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/grinev/opencode-telegram-bot/actions/workflows/ci.yml)
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

4. Run bot:

```bash
npx @grinev/opencode-telegram-bot
```

## Main commands

- `/status`
- `/new`
- `/stop`
- `/sessions`
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
npm install
npm run build
npm run lint
npm test
```
