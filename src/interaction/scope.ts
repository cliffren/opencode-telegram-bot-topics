import type { Context } from "grammy";

export function getInteractionScopeKey(chatId: number | null, threadId: number | null): string {
  return `${chatId ?? "none"}:${threadId ?? "private"}`;
}

export function getInteractionScopeKeyFromContext(ctx: Context): string {
  const callbackThreadId =
    ctx.callbackQuery?.message && "message_thread_id" in ctx.callbackQuery.message
      ? ((ctx.callbackQuery.message as { message_thread_id?: number }).message_thread_id ?? null)
      : null;
  const threadId = callbackThreadId ?? ctx.message?.message_thread_id ?? null;
  return getInteractionScopeKey(ctx.chat?.id ?? null, threadId);
}
