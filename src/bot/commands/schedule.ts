import { CommandContext, Context } from "grammy";
import { scheduleCommand as openScheduleMenu } from "../handlers/schedule.js";

export async function scheduleCommand(ctx: CommandContext<Context>): Promise<void> {
  await openScheduleMenu(ctx);
}
