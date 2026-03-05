export const en = {
  "cmd.description.status": "Server and session status",
  "cmd.description.new": "Create a new session",
  "cmd.description.stop": "Stop current action",
  "cmd.description.sessions": "List sessions",
  "cmd.description.delete_sessions": "Delete sessions",
  "cmd.description.projects": "List projects",
  "cmd.description.model": "Select model",
  "cmd.description.agent": "Select mode",
  "cmd.description.opencode_start": "Start OpenCode server",
  "cmd.description.opencode_restart": "Restart OpenCode server",
  "cmd.description.opencode_stop": "Stop OpenCode server",
  "cmd.description.help": "Help",

  "callback.unknown_command": "Unknown command",
  "callback.processing_error": "Processing error",

  "error.load_agents": "❌ Failed to load agents list",
  "error.load_models": "❌ Failed to load models list",
  "error.load_variants": "❌ Failed to load variants list",
  "error.context_button": "❌ Failed to process context button",
  "error.generic": "🔴 Something went wrong.",

  "interaction.blocked.expired": "⚠️ This interaction has expired. Please start it again.",
  "interaction.blocked.expected_callback":
    "⚠️ Please use the inline buttons for this step or tap Cancel.",
  "interaction.blocked.expected_text": "⚠️ Please send a text message for this step.",
  "interaction.blocked.expected_command": "⚠️ Please send a command for this step.",
  "interaction.blocked.command_not_allowed":
    "⚠️ This command is not available in the current step.",
  "interaction.blocked.finish_current":
    "⚠️ Finish the current interaction first (answer or cancel), then open another menu.",

  "inline.blocked.expected_choice": "⚠️ Choose an option using the inline buttons or tap Cancel.",
  "inline.blocked.command_not_allowed":
    "⚠️ This command is not available while inline menu is active.",

  "question.blocked.expected_answer":
    "⚠️ Answer the current question using buttons, Custom answer, or Cancel.",
  "question.blocked.command_not_allowed":
    "⚠️ This command is not available until current question flow is completed.",

  "inline.button.cancel": "❌ Cancel",
  "inline.inactive_callback": "This menu is inactive",
  "inline.cancelled_callback": "Cancelled",

  "common.unknown": "unknown",
  "common.unknown_error": "unknown error",

  "start.welcome":
    "👋 Welcome to OpenCode Telegram Bot!\n\nUse commands:\n/projects — select project\n/sessions — session list\n/new — new session\n/agent — switch mode\n/model — select model\n/status — status\n/help — help",
  "help.text":
    "📖 **Help**\n\n/status - Check server status\n/sessions - Session list\n/new - Create new session\n/bg - Background tasks\n/help - Help",

  "bot.thinking": "💭 Thinking...",
  "bot.project_not_selected":
    "🏗 Project is not selected.\n\nFirst select a project with /projects.",
  "bot.creating_session": "🔄 Creating a new session...",
  "bot.create_session_error":
    "🔴 Failed to create session. Try /new or check server status with /status.",
  "bot.session_created": "✅ Session created: {title}",
  "bot.session_busy":
    "⏳ Agent is already running a task. Wait for completion or use /stop to interrupt current run.",
  "bot.session_reset_project_mismatch":
    "⚠️ Active session does not match the selected project, so it was reset. Use /sessions to pick one or /new to create a new session.",
  "bot.prompt_send_error": "Failed to send request to OpenCode.",
  "bot.session_error": "🔴 OpenCode returned an error: {message}",
  "bot.telegram_rate_limited":
    "⚠️ Telegram rate limit reached. Status updates are temporarily paused ({seconds}s).",
  "bot.unknown_command": "⚠️ Unknown command: {command}. Use /help to see available commands.",

  "status.header_running": "🟢 **OpenCode Server is running**",
  "status.health.healthy": "Healthy",
  "status.health.unhealthy": "Unhealthy",
  "status.line.health": "Status: {health}",
  "status.line.version": "Version: {version}",
  "status.line.managed_yes": "Managed by bot: Yes",
  "status.line.managed_no": "Managed by bot: No",
  "status.line.pid": "PID: {pid}",
  "status.line.uptime_sec": "Uptime: {seconds} sec",
  "status.line.mode": "Mode: {mode}",
  "status.line.model": "Model: {model}",
  "status.agent_not_set": "not set",
  "status.project_selected": "🏗 Project: {project}",
  "status.project_not_selected": "🏗 Project: not selected",
  "status.project_hint": "Use /projects to select a project",
  "status.session_selected": "📋 Current session: {title}",
  "status.session_not_selected": "📋 Current session: not selected",
  "status.session_hint": "Use /sessions to select one or /new to create one",
  "status.server_unavailable":
    "🔴 OpenCode Server is unavailable\n\nUse /opencode_start to start the server.",

  "projects.empty":
    "📭 No projects found.\n\nOpen a directory in OpenCode and create at least one session, then it will appear here.",
  "projects.select": "Select a project:",
  "projects.select_with_current": "Select a project:\n\nCurrent: 🏗 {project}",
  "projects.fetch_error":
    "🔴 OpenCode Server is unavailable or an error occurred while loading projects.",
  "projects.selected":
    "✅ Project selected: {project}\n\n📋 Session was reset. Use /sessions or /new for this project.",
  "projects.select_error": "🔴 Failed to select project.",
  "sessions.project_not_selected":
    "🏗 Project is not selected.\n\nFirst select a project with /projects.",
  "sessions.empty": "📭 No sessions found.\n\nCreate a new session with /new.",
  "sessions.select": "Select a session:",
  "sessions.select_sub": "Select a session (main or sub-session):",
  "sessions.button.back": "⬅️ Back",
  "sessions.fetch_error":
    "🔴 OpenCode Server is unavailable or an error occurred while loading sessions.",
  "sessions.select_project_first": "🔴 Project is not selected. Use /projects.",
  "sessions.loading_context": "⏳ Loading context and latest messages...",
  "sessions.selected": "✅ Session selected: {title}",
  "sessions.select_error": "🔴 Failed to select session.",
  "sessions.preview.empty": "No recent messages.",
  "sessions.preview.title": "Recent messages:",
  "sessions.preview.you": "You:",
  "sessions.preview.agent": "Agent:",

  "delete_sessions.project_not_selected":
    "🏗 Project is not selected.\n\nFirst select a project with /projects.",
  "delete_sessions.empty": "📭 No sessions found to delete.",
  "delete_sessions.select": "Select a session to delete:",
  "delete_sessions.select_sub": "Select a session to delete (main or sub-session):",
  "delete_sessions.select_project_first": "🔴 Project is not selected. Use /projects.",
  "delete_sessions.confirm_single": '⚠️ Delete session "{title}"?\n\nThis action cannot be undone.',
  "delete_sessions.confirm_cascade":
    '⚠️ Delete main session "{title}" and {count} sub-session(s)?\n\nThis action cannot be undone.',
  "delete_sessions.button.confirm": "✅ Confirm delete",
  "delete_sessions.button.cancel": "❌ Cancel",
  "delete_sessions.deleted": "✅ Deleted {count} session(s).",
  "delete_sessions.fetch_error":
    "🔴 OpenCode Server is unavailable or an error occurred while loading sessions.",
  "delete_sessions.delete_error": "🔴 Failed to delete session.",

  "new.project_not_selected":
    "🏗 Project is not selected.\n\nFirst select a project with /projects.",
  "new.created": "✅ New session created: {title}",
  "new.create_error":
    "🔴 OpenCode Server is unavailable or an error occurred while creating session.",

  "stop.no_active_session":
    "🛑 Agent was not started\n\nCreate a session with /new or select one via /sessions.",
  "stop.in_progress":
    "🛑 Event stream stopped, sending abort signal...\n\nWaiting for agent to stop.",
  "stop.warn_unconfirmed":
    "⚠️ Event stream stopped, but server did not confirm abort.\n\nCheck /status and retry /stop in a few seconds.",
  "stop.warn_maybe_finished": "⚠️ Event stream stopped, but the agent may have already finished.",
  "stop.success": "✅ Agent action interrupted. No more messages from this run will be sent.",
  "stop.warn_still_busy":
    "⚠️ Signal sent, but agent is still busy.\n\nEvent stream is already disabled, so no intermediate messages will be sent.",
  "stop.warn_timeout":
    "⚠️ Abort request timeout.\n\nEvent stream is already disabled, retry /stop in a few seconds.",
  "stop.warn_local_only": "⚠️ Event stream stopped locally, but server-side abort failed.",
  "stop.error": "🔴 Failed to stop action.\n\nEvent stream is stopped, try /stop again.",

  "opencode_start.already_running_managed":
    "⚠️ OpenCode Server is already running\n\nPort: {port}\nPID: {pid}\nUptime: {seconds} seconds",
  "opencode_start.already_running_external":
    "✅ OpenCode Server is already running as an external process\n\nPort: {port}\nVersion: {version}\n\nThis server was not started by bot, so /opencode-stop cannot stop it.",
  "opencode_start.starting": "🔄 Starting OpenCode Server...",
  "opencode_start.start_error":
    "🔴 Failed to start OpenCode Server\n\nError: {error}\n\nCheck that OpenCode CLI is installed and available in PATH:\n`opencode --version`\n`npm install -g @opencode-ai/cli`",
  "opencode_start.started_not_ready":
    "⚠️ OpenCode Server started, but is not responding\n\nPort: {port}\nPID: {pid}\n\nServer may still be starting. Try /status in a few seconds.",
  "opencode_start.success":
    "✅ OpenCode Server started successfully\n\nPort: {port}\nPID: {pid}\nVersion: {version}",
  "opencode_start.error":
    "🔴 An error occurred while starting server.\n\nCheck application logs for details.",
  "opencode_stop.external_running":
    "⚠️ OpenCode Server is running as an external process\n\nPort: {port}\nThis server was not started via /opencode-start.\nStop it manually or use /status to check state.",
  "opencode_stop.not_running": "⚠️ OpenCode Server is not running on port {port}",
  "opencode_stop.stopping": "🛑 Stopping OpenCode Server...\n\nPort: {port}\nPID: {pid}",
  "opencode_stop.stop_error": "🔴 Failed to stop OpenCode Server\n\nError: {error}",
  "opencode_stop.success": "✅ OpenCode Server stopped successfully on port {port}",
  "opencode_stop.error":
    "🔴 An error occurred while stopping server.\n\nCheck application logs for details.",

  "opencode_restart.restarting": "🔄 Restarting OpenCode Server...\n\nPort: {port}",
  "opencode_restart.external_running":
    "⚠️ OpenCode Server is running as an external process on port {port}.\n\nFor safety, bot will not restart external processes.",
  "opencode_restart.stop_error":
    "🔴 Failed to stop OpenCode Server before restart\n\nError: {error}",
  "opencode_restart.start_error":
    "🔴 Failed to start OpenCode Server during restart\n\nError: {error}",
  "opencode_restart.started_not_ready":
    "⚠️ OpenCode Server restarted, but is not responding\n\nPort: {port}\nPID: {pid}",
  "opencode_restart.success":
    "✅ OpenCode Server restarted successfully\n\nPort: {port}\nPID: {pid}\nVersion: {version}",
  "opencode_restart.error": "🔴 An error occurred while restarting server.",

  "agent.changed_callback": "Mode changed: {name}",
  "agent.changed_message": "✅ Mode changed to: {name}",
  "agent.change_error_callback": "Failed to change mode",
  "agent.menu.current": "Current mode: {name}\n\nSelect mode:",
  "agent.menu.select": "Select work mode:",

  "model.changed_callback": "Model changed: {name}",
  "model.changed_message": "✅ Model changed to: {name}",
  "model.change_error_callback": "Failed to change model",
  "model.menu.empty": "⚠️ No available models",
  "model.menu.current": "Current model: {name}\n\nSelect model:",
  "model.menu.error": "🔴 Failed to get models list",

  "variant.model_not_selected_callback": "Error: model is not selected",
  "variant.changed_callback": "Variant changed: {name}",
  "variant.changed_message": "✅ Variant changed to: {name}",
  "variant.change_error_callback": "Failed to change variant",
  "variant.select_model_first": "⚠️ Select a model first",
  "variant.menu.empty": "⚠️ No available variants",
  "variant.menu.current": "Current variant: {name}\n\nSelect variant:",
  "variant.menu.error": "🔴 Failed to get variants list",

  "context.button.confirm": "✅ Yes, compact context",
  "context.no_active_session": "⚠️ No active session. Create a session with /new",
  "context.confirm_text":
    '📊 Context compaction for session "{title}"\n\nThis will reduce context usage by removing old messages from history. Current task will not be interrupted.\n\nContinue?',
  "context.callback_session_not_found": "Session not found",
  "context.callback_compacting": "Compacting context...",
  "context.progress": "⏳ Compacting context...",
  "context.error": "❌ Context compaction failed",
  "context.success": "✅ Context compacted successfully",

  "permission.inactive_callback": "Permission request is inactive",
  "permission.processing_error_callback": "Processing error",
  "permission.no_active_request_callback": "Error: no active request",
  "permission.reply.once": "Allowed once",
  "permission.reply.always": "Always allowed",
  "permission.reply.reject": "Rejected",
  "permission.send_reply_error": "❌ Failed to send permission reply",
  "permission.blocked.expected_reply":
    "⚠️ Please answer the permission request first using the buttons above.",
  "permission.blocked.command_not_allowed":
    "⚠️ This command is not available until you answer the permission request.",
  "permission.header": "{emoji} **Permission request: {name}**\n\n",
  "permission.button.allow": "✅ Allow once",
  "permission.button.always": "🔓 Allow always",
  "permission.button.reject": "❌ Reject",
  "permission.name.bash": "Bash",
  "permission.name.edit": "Edit",
  "permission.name.write": "Write",
  "permission.name.read": "Read",
  "permission.name.webfetch": "Web Fetch",
  "permission.name.websearch": "Web Search",
  "permission.name.glob": "File Search",
  "permission.name.grep": "Content Search",
  "permission.name.list": "List Directory",
  "permission.name.task": "Task",
  "permission.name.lsp": "LSP",

  "question.inactive_callback": "Poll is inactive",
  "question.processing_error_callback": "Processing error",
  "question.select_one_required_callback": "Select at least one option",
  "question.enter_custom_callback": "Send your custom answer as a message",
  "question.cancelled": "❌ Poll cancelled",
  "question.answer_already_received": "Answer already received, please wait...",
  "question.completed_no_answers": "✅ Poll completed (no answers)",
  "question.no_active_project": "❌ No active project",
  "question.no_active_request": "❌ No active request",
  "question.send_answers_error": "❌ Failed to send answers to agent",
  "question.multi_hint": "\n*You can select multiple options*",
  "question.button.submit": "✅ Done",
  "question.button.custom": "🔤 Custom answer",
  "question.button.cancel": "❌ Cancel",
  "question.use_custom_button_first":
    '⚠️ To send text, tap "Custom answer" for the current question first.',
  "question.summary.title": "✅ Poll completed!\n\n",
  "question.summary.question": "Question {index}:\n{question}\n\n",
  "question.summary.answer": "Answer:\n{answer}\n\n",

  "keyboard.agent_mode": "{emoji} {name} Mode",
  "keyboard.context": "📊 {used} / {limit} ({percent}%)",
  "keyboard.context_empty": "📊 0",
  "keyboard.variant": "💭 {name}",
  "keyboard.variant_default": "💡 Default",
  "keyboard.updated": "⌨️ Keyboard updated",

  "pinned.default_session_title": "new session",
  "pinned.unknown": "Unknown",
  "pinned.line.project": "Project: {project}",
  "pinned.line.model": "Model: {model}",
  "pinned.line.context": "Context: {used} / {limit} ({percent}%)",
  "pinned.files.title": "Files ({count}):",
  "pinned.files.item": "  {path}{diff}",
  "pinned.files.more": "  ... and {count} more",

  "tool.todo.overflow": "*({count} more tasks)*",
  "tool.file_header.write":
    "Write File/Path: {path}\n============================================================\n\n",
  "tool.file_header.edit":
    "Edit File/Path: {path}\n============================================================\n\n",

  "runtime.wizard.ask_token": "Enter Telegram bot token (get it from @BotFather).\n> ",
  "runtime.wizard.token_required": "Token is required. Please try again.\n",
  "runtime.wizard.token_invalid":
    "Token looks invalid (expected format <id>:<secret>). Please try again.\n",
  "runtime.wizard.ask_user_id":
    "Enter your Telegram User ID (you can get it from @userinfobot).\n> ",
  "runtime.wizard.user_id_invalid": "Enter a positive integer (> 0).\n",
  "runtime.wizard.ask_api_url":
    "Enter OpenCode API URL (optional).\nPress Enter to use default: {defaultUrl}\n> ",
  "runtime.wizard.api_url_invalid": "Enter a valid URL (http/https) or press Enter for default.\n",
  "runtime.wizard.start": "Starting first-run wizard for OpenCode Telegram Bot.\n",
  "runtime.wizard.saved": "Configuration saved:\n- {envPath}\n- {settingsPath}\n",
  "runtime.wizard.not_configured_starting":
    "Application is not configured yet. Starting wizard...\n",
  "runtime.wizard.tty_required":
    "Interactive wizard requires a TTY terminal. Run `opencode-telegram config` in an interactive shell.",

  "rename.no_session": "⚠️ No active session. Create or select a session first.",
  "rename.prompt": "📝 Enter new title for session:\n\nCurrent: {title}",
  "rename.empty_title": "⚠️ Title cannot be empty.",
  "rename.success": "✅ Session renamed to: {title}",
  "rename.error": "🔴 Failed to rename session.",
  "rename.cancelled": "❌ Rename cancelled.",
  "rename.inactive_callback": "Rename request is inactive",
  "rename.inactive": "⚠️ Rename request is not active. Run /rename again.",
  "rename.blocked.expected_name":
    "⚠️ Enter a new session name as text or tap Cancel in rename message.",
  "rename.blocked.command_not_allowed":
    "⚠️ This command is not available while rename is waiting for a new name.",
  "rename.button.cancel": "❌ Cancel",

  "cmd.description.rename": "Rename current session",
  "cmd.description.screenshot": "Capture and send a screenshot",
  "cmd.description.sendfile": "Send a file to chat",
  "cmd.description.bg": "Background tasks",
  "cmd.description.schedule": "Scheduled tasks",

  "schedule.menu.title": "⏰ Schedule tasks\nTimezone: {tz}\n\nChoose an action:",
  "schedule.menu.button.add_once": "🗓 Fixed time",
  "schedule.menu.button.add_after": "⏳ After delay",
  "schedule.menu.button.add_daily": "🔁 Daily",
  "schedule.menu.button.add_weekly": "📆 Weekly",
  "schedule.menu.button.add_monthly": "🗓 Monthly",
  "schedule.menu.button.add_yearly": "🎉 Yearly",
  "schedule.menu.button.list": "📋 List tasks",
  "schedule.menu.button.back": "⬅️ Back",
  "schedule.inactive_callback": "Schedule menu is inactive",
  "schedule.input.once": "Send date/time in format: YYYY-MM-DD HH:mm",
  "schedule.input.after": "Send delay in format: 30m or 2h",
  "schedule.input.daily": "Send daily time in format: HH:mm",
  "schedule.input.weekly_day": "Choose weekday:",
  "schedule.input.weekly_time": "Send weekly time in format: HH:mm",
  "schedule.input.monthly": "Send monthly schedule in format: DD HH:mm",
  "schedule.input.yearly": "Send yearly schedule in format: MM-DD HH:mm",
  "schedule.input.prompt": "Now send the task text to run in current session.",
  "schedule.invalid.once": "Invalid date/time. Use YYYY-MM-DD HH:mm and future time.",
  "schedule.invalid.after": "Invalid delay. Use format like 30m or 2h.",
  "schedule.invalid.time": "Invalid time. Use HH:mm.",
  "schedule.invalid.monthly": "Invalid format. Use DD HH:mm (day 1-31).",
  "schedule.invalid.yearly": "Invalid format. Use MM-DD HH:mm.",
  "schedule.invalid.weekday": "Invalid weekday",
  "schedule.invalid.generic": "Schedule input is invalid. Please start again with /schedule.",
  "schedule.create.no_session": "No active session for this chat/topic. Select a session first.",
  "schedule.create.failed": "Failed to create scheduled task.",
  "schedule.created": "✅ Task created\nID: {id}\nRule: {rule}\nNext run: {next}\nTimezone: {tz}",
  "schedule.tasks.empty": "No scheduled tasks in this chat/topic.",
  "schedule.tasks.header": "📋 Scheduled tasks\nTimezone: {tz}",
  "schedule.tasks.item": "• [{id}] {status} | next: {next}\n  {rule}",
  "schedule.tasks.more": "... and {count} more",
  "schedule.tasks.button.pause": "⏸ {id}",
  "schedule.tasks.button.resume": "▶️ {id}",
  "schedule.tasks.button.delete": "🗑 {id}",
  "schedule.tasks.button.prev": "⬅️ Prev",
  "schedule.tasks.button.next": "Next ➡️",
  "schedule.tasks.button.page": "{current}/{total}",

  "bg.menu.title": "🧵 Background tasks",
  "bg.menu.button.new": "➕ New",
  "bg.menu.button.list": "📋 Task list",
  "bg.menu.button.back": "⬅️ Back",
  "bg.prompt.ask": "Send the task prompt for background execution:",
  "bg.post.choose": "Choose follow-up action:",
  "bg.post.none": "No follow-up",
  "bg.post.summarize": "Summarize result",
  "bg.post.custom": "Custom follow-up",
  "bg.post.custom_prompt": "Send custom follow-up instructions:",
  "bg.create.no_session": "⚠️ No active session. Use /sessions or /new.",
  "bg.create.plan_mode_blocked":
    "Background task not started because agent is in plan mode. Switch to build mode and retry.",
  "bg.create.queued": "✅ Background task queued.",
  "bg.create.failed": "🔴 Failed to create background task.",
  "bg.create.dispatch_timeout": "Background job did not start in time. Please retry in build mode.",
  "bg.list.title": "Background tasks:",
  "bg.list.empty": "📭 No background tasks.",
  "bg.list.page": "Page {page}/{total}",
  "bg.status.queued": "queued",
  "bg.status.running": "running",
  "bg.status.succeeded": "done",
  "bg.status.failed": "failed",
  "bg.tasks.button.stop": "⏹ Stop {id}",
  "bg.tasks.button.restart": "🔁 Restart {id}",
  "bg.tasks.button.delete": "🗑 Delete {id}",
  "bg.tasks.button.prev": "⬅️ Prev",
  "bg.tasks.button.next": "➡️ Next",
  "bg.tasks.not_found": "Task not found",
  "bg.tasks.stop_not_running": "Task is not running",
  "bg.tasks.restart_only_stopped": "Task is still active. Stop it first before restarting.",
  "bg.tasks.delete_only_completed": "Only completed tasks can be deleted",
  "bg.tasks.deleted_callback": "Deleted",
  "bg.tasks.stopped_callback": "Stopped",
  "bg.tasks.restarted_callback": "Restarted",
  "bg.tasks.cancelled": "Cancelled by user",
  "bg.notify.default_title": "Background task",
  "bg.notify.started": "🔄 Background task started: {title}",
  "bg.notify.done": "✅ Background task completed: {title}",
  "bg.notify.failed": "❌ Background task failed: {title}",
  "bg.notify.log_path": "Log: {path}",
  "schedule.tasks.page": "Page {current}/{total}",
  "schedule.tasks.not_found": "Task not found",
  "schedule.tasks.updated_callback": "Task updated",
  "schedule.tasks.deleted_callback": "Task deleted",
  "schedule.rule.once": "once at {value}",
  "schedule.rule.daily": "daily at {value}",
  "schedule.rule.weekly": "weekly on {day} {time}",
  "schedule.rule.monthly": "monthly on day {day} {time}",
  "schedule.rule.yearly": "yearly on {month}-{day} {time}",
  "schedule.weekday.mon": "Mon",
  "schedule.weekday.tue": "Tue",
  "schedule.weekday.wed": "Wed",
  "schedule.weekday.thu": "Thu",
  "schedule.weekday.fri": "Fri",
  "schedule.weekday.sat": "Sat",
  "schedule.weekday.sun": "Sun",
  "schedule.weekday.short.0": "Sun",
  "schedule.weekday.short.1": "Mon",
  "schedule.weekday.short.2": "Tue",
  "schedule.weekday.short.3": "Wed",
  "schedule.weekday.short.4": "Thu",
  "schedule.weekday.short.5": "Fri",
  "schedule.weekday.short.6": "Sat",

  "sendfile.usage": "Usage: /sendfile <file_path>\n\nExample: /sendfile /path/to/image.png",
  "sendfile.file_not_found": "🔴 File not found",
  "sendfile.not_a_file": "🔴 Path is not a file",
  "sendfile.too_large": "🔴 File too large: {size}KB (max {limit}KB)",
  "sendfile.too_large_unknown": "🔴 File too large (max {limit}KB)",
  "sendfile.error": "🔴 Failed to send file",
  "sendfile.multiple_found": "📁 Found multiple matches for `{path}`. Choose a file:",
  "sendfile.choice.cancel": "Cancel",
  "sendfile.choice.cancelled": "❌ File selection cancelled.",
  "sendfile.choice.expired": "Selection expired. Please request file again.",
  "sendfile.choice.sent": "✅ Sent: `{path}`",
  "sendfile.choice.failed": "🔴 Failed to send selected file for `{path}`",

  "screenshot.capturing": "📸 Capturing screenshot...",
  "screenshot.sent": "✅ Screenshot captured and sent",
  "screenshot.failed":
    "🔴 Failed to capture screenshot. Please grant Screen Recording permission and try again.",
  "screenshot.failed_thread":
    "🔴 Failed to send screenshot to this topic (message thread not found). Please retry directly in that topic.",
  "screenshot.unsupported": "⚠️ Screenshot capture is currently supported on macOS only.",

  "cli.usage":
    "Usage:\n  opencode-telegram [start] [--mode sources|installed]\n  opencode-telegram status\n  opencode-telegram stop\n  opencode-telegram config\n\nNotes:\n  - No command defaults to `start`\n  - `--mode` is currently supported for `start` only",
  "cli.placeholder.status":
    "Command `status` is currently a placeholder. Real status checks will be added in service layer (Phase 5).",
  "cli.placeholder.stop":
    "Command `stop` is currently a placeholder. Real background process stop will be added in service layer (Phase 5).",
  "cli.placeholder.unavailable": "Command is unavailable.",
  "cli.error.prefix": "CLI error: {message}",
  "cli.args.unknown_command": "Unknown command: {value}",
  "cli.args.mode_requires_value": "Option --mode requires a value: sources|installed",
  "cli.args.invalid_mode": "Invalid mode value: {value}. Expected sources|installed",
  "cli.args.unknown_option": "Unknown option: {value}",
  "cli.args.mode_only_start": "Option --mode is supported only for the start command",

  "legacy.models.fetch_error": "🔴 Failed to get models list. Check server status with /status.",
  "legacy.models.empty": "📋 No available models. Configure providers in OpenCode.",
  "legacy.models.header": "📋 **Available models:**\n\n",
  "legacy.models.no_provider_models": "  ⚠️ No available models\n",
  "legacy.models.env_hint": "💡 To use model in .env:\n",
  "legacy.models.error": "🔴 An error occurred while loading models list.",

  "stt.recognizing": "🎤 Recognizing audio...",
  "stt.recognized": "🎤 Recognized:\n{text}",
  "stt.not_configured":
    "🎤 Voice recognition is not configured.\n\nSet STT_API_URL and STT_API_KEY in .env to enable it.",
  "stt.error": "🔴 Failed to recognize audio: {error}",
  "stt.empty_result": "🎤 No speech detected in the audio message.",

  "image.downloading": "📥 Downloading image...",
  "image.download_failed": "🔴 Failed to download image",
  "image.sending_to_opencode": "🤖 Sending to OpenCode...",
  "image.sent": "✅ Image sent to OpenCode",
  "image.error": "🔴 Failed to process image: {error}",
  "file.downloading": "📥 Downloading file...",
  "file.download_failed": "🔴 Failed to download file",
  "file.sending_to_opencode": "🤖 Sending file to OpenCode...",
  "file.sent": "✅ File sent to OpenCode",
  "file.error": "🔴 Failed to process file: {error}",
} as const;

export type I18nKey = keyof typeof en;
export type I18nDictionary = Record<I18nKey, string>;
