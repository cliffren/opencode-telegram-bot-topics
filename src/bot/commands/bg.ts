import type { Context } from "grammy";
import { handleBgCommand } from "../handlers/bg.js";

export async function bgCommand(ctx: Context): Promise<void> {
  await handleBgCommand(ctx);
}
