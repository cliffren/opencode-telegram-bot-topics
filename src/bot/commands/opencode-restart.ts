import { CommandContext, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { processManager } from "../../process/manager.js";
import { getConfiguredOpenCodeTarget } from "../../process/target.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

async function waitForServerReady(maxWaitMs: number = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const { data, error } = await opencodeClient.global.health();
      if (!error && data?.healthy) {
        return true;
      }
    } catch {
      // server not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

export async function opencodeRestartCommand(ctx: CommandContext<Context>) {
  try {
    const target = getConfiguredOpenCodeTarget();

    if (!processManager.isRunningForPort(target.port)) {
      try {
        const { data, error } = await opencodeClient.global.health();
        if (!error && data?.healthy) {
          await ctx.reply(t("opencode_restart.external_running", { port: String(target.port) }));
          return;
        }
      } catch {
        // no external healthy server
      }
    }

    const statusMessage = await ctx.reply(t("opencode_restart.restarting", { port: String(target.port) }));

    if (processManager.isRunningForPort(target.port)) {
      const stopped = await processManager.stop(5000);
      if (!stopped.success) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMessage.message_id,
          t("opencode_restart.stop_error", { error: stopped.error || t("common.unknown_error") }),
        );
        return;
      }
    }

    const started = await processManager.start(target);
    if (!started.success) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        t("opencode_restart.start_error", { error: started.error || t("common.unknown_error") }),
      );
      return;
    }

    const ready = await waitForServerReady(10_000);
    if (!ready) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        t("opencode_restart.started_not_ready", {
          pid: processManager.getPID() ?? "-",
          port: String(target.port),
        }),
      );
      return;
    }

    const { data: health } = await opencodeClient.global.health();
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMessage.message_id,
      t("opencode_restart.success", {
        pid: processManager.getPID() ?? "-",
        version: health?.version || t("common.unknown"),
        port: String(target.port),
      }),
    );
  } catch (err) {
    logger.error("[Bot] Error in /opencode-restart command:", err);
    await ctx.reply(t("opencode_restart.error"));
  }
}
