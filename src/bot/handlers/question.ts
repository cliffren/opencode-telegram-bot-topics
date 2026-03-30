import { Context, InlineKeyboard } from "grammy";
import { questionManager } from "../../question/manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProjectForScope } from "../../project/scope.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { interactionManager } from "../../interaction/manager.js";
import {
  getInteractionScopeKey,
  getInteractionScopeKeyFromContext,
} from "../../interaction/scope.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { t } from "../../i18n/index.js";
import { getCurrentSessionByThread } from "./prompt.js";

const MAX_BUTTON_LENGTH = 60;

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function clearQuestionInteraction(reason: string, scopeKey?: string): void {
  const state = interactionManager.getSnapshot(scopeKey);
  if (state?.kind === "question") {
    interactionManager.clear(reason, scopeKey);
  }
}

function syncQuestionInteractionState(
  expectedInput: "callback" | "mixed",
  questionIndex: number,
  messageId: number | null,
  scopeKey?: string,
): void {
  const routeContext = questionManager.getRouteContext(scopeKey);
  const metadata: Record<string, unknown> = {
    questionIndex,
    inputMode: expectedInput === "mixed" ? "custom" : "options",
  };

  const requestID = questionManager.getRequestID(scopeKey);
  if (requestID) {
    metadata.requestID = requestID;
  }

  if (messageId !== null) {
    metadata.messageId = messageId;
  }

  const interactionChatId = routeContext.chatId;
  if (interactionChatId !== null) {
    metadata.interactionChatId = interactionChatId;
  }

  metadata.interactionThreadId = routeContext.threadId;

  const state = interactionManager.getSnapshot(scopeKey);
  if (state?.kind === "question") {
    interactionManager.transition(
      {
        expectedInput,
        metadata,
      },
      scopeKey,
    );
    return;
  }

  interactionManager.start(
    {
      kind: "question",
      expectedInput,
      metadata,
    },
    scopeKey,
  );
}

export async function handleQuestionCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) return false;

  if (!data.startsWith("question:")) {
    return false;
  }

  logger.debug(`[QuestionHandler] Received callback: ${data}`);

  const scopeKey = getInteractionScopeKeyFromContext(ctx);

  if (!questionManager.isActive(scopeKey)) {
    clearQuestionInteraction("question_inactive_callback", scopeKey);
    await ctx.answerCallbackQuery({ text: t("question.inactive_callback"), show_alert: true });
    return true;
  }

  const callbackMessageId = getCallbackMessageId(ctx);
  if (!questionManager.isActiveMessage(callbackMessageId, scopeKey)) {
    await ctx.answerCallbackQuery({ text: t("question.inactive_callback"), show_alert: true });
    return true;
  }

  const parts = data.split(":");
  const action = parts[1];
  const questionIndex = parseInt(parts[2], 10);

  if (Number.isNaN(questionIndex) || questionIndex !== questionManager.getCurrentIndex(scopeKey)) {
    await ctx.answerCallbackQuery({ text: t("question.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    switch (action) {
      case "select":
        {
          const optionIndex = parseInt(parts[3], 10);
          if (Number.isNaN(optionIndex)) {
            await ctx.answerCallbackQuery({
              text: t("question.processing_error_callback"),
              show_alert: true,
            });
            break;
          }

          await handleSelectOption(ctx, questionIndex, optionIndex, scopeKey);
        }
        break;
      case "submit":
        await handleSubmitAnswer(ctx, questionIndex, scopeKey);
        break;
      case "custom":
        await handleCustomAnswer(ctx, questionIndex, scopeKey);
        break;
      case "cancel":
        await handleCancelPoll(ctx, scopeKey);
        break;
      default:
        await ctx.answerCallbackQuery({
          text: t("question.processing_error_callback"),
          show_alert: true,
        });
        break;
    }
  } catch (err) {
    logger.error("[QuestionHandler] Error handling callback:", err);
    await ctx.answerCallbackQuery({
      text: t("question.processing_error_callback"),
      show_alert: true,
    });
  }

  return true;
}

async function handleSelectOption(
  ctx: Context,
  questionIndex: number,
  optionIndex: number,
  scopeKey?: string,
): Promise<void> {
  logger.debug(
    `[QuestionHandler] handleSelectOption: qIndex=${questionIndex}, oIndex=${optionIndex}`,
  );

  const question = questionManager.getCurrentQuestion(scopeKey);
  if (!question) {
    logger.debug("[QuestionHandler] No current question");
    return;
  }

  if (questionManager.isWaitingForCustomInput(questionIndex, scopeKey)) {
    questionManager.clearCustomInput(scopeKey);
    syncQuestionInteractionState(
      "callback",
      questionIndex,
      questionManager.getActiveMessageId(scopeKey),
      scopeKey,
    );
  }

  questionManager.selectOption(questionIndex, optionIndex, scopeKey);

  if (question.multiple) {
    logger.debug("[QuestionHandler] Multiple choice mode, updating message");
    await updateQuestionMessage(ctx);
    await ctx.answerCallbackQuery();
  } else {
    logger.debug("[QuestionHandler] Single choice mode, moving to next question");
    await ctx.answerCallbackQuery();

    const answer = questionManager.getSelectedAnswer(questionIndex, scopeKey);
    logger.debug(`[QuestionHandler] Selected answer for question ${questionIndex}: ${answer}`);

    // Delete the question message before showing the next one
    await ctx.deleteMessage().catch(() => {});

    // DO NOT send the answer immediately - move to the next question
    // All answers will be sent together after the user answers all questions
    await showNextQuestion(ctx, scopeKey);
  }
}

async function handleSubmitAnswer(
  ctx: Context,
  questionIndex: number,
  scopeKey?: string,
): Promise<void> {
  if (questionManager.isWaitingForCustomInput(questionIndex, scopeKey)) {
    questionManager.clearCustomInput(scopeKey);
    syncQuestionInteractionState(
      "callback",
      questionIndex,
      questionManager.getActiveMessageId(scopeKey),
      scopeKey,
    );
  }

  const answer = questionManager.getSelectedAnswer(questionIndex, scopeKey);

  if (!answer) {
    await ctx.answerCallbackQuery({
      text: t("question.select_one_required_callback"),
      show_alert: true,
    });
    return;
  }

  logger.debug(`[QuestionHandler] Submit answer for question ${questionIndex}: ${answer}`);

  await ctx.answerCallbackQuery();

  // Delete the question message before showing the next one
  await ctx.deleteMessage().catch(() => {});

  // DO NOT send the answer immediately - move to the next question
  // All answers will be sent together after the user answers all questions
  await showNextQuestion(ctx, scopeKey);
}

async function handleCustomAnswer(
  ctx: Context,
  questionIndex: number,
  scopeKey?: string,
): Promise<void> {
  questionManager.startCustomInput(questionIndex, scopeKey);
  syncQuestionInteractionState(
    "mixed",
    questionIndex,
    questionManager.getActiveMessageId(scopeKey),
    scopeKey,
  );

  await ctx.answerCallbackQuery({
    text: t("question.enter_custom_callback"),
    show_alert: true,
  });
}

async function handleCancelPoll(ctx: Context, scopeKey?: string): Promise<void> {
  questionManager.cancel(scopeKey);
  clearQuestionInteraction("question_cancelled", scopeKey);

  await ctx.editMessageText(t("question.cancelled")).catch(() => {});
  await ctx.answerCallbackQuery();

  questionManager.clear(scopeKey);
}

async function updateQuestionMessage(ctx: Context): Promise<void> {
  const scopeKey = getInteractionScopeKeyFromContext(ctx);
  const question = questionManager.getCurrentQuestion(scopeKey);
  if (!question) {
    logger.debug("[QuestionHandler] updateQuestionMessage: no current question");
    return;
  }

  const text = formatQuestionText(question, scopeKey);
  const keyboard = buildQuestionKeyboard(
    question,
    questionManager.getSelectedOptions(questionManager.getCurrentIndex(scopeKey), scopeKey),
    scopeKey,
  );

  logger.debug("[QuestionHandler] Updating question message");

  try {
    await ctx.editMessageText(text, {
      reply_markup: keyboard,
      parse_mode: "Markdown",
    });
  } catch (err) {
    logger.error("[QuestionHandler] Failed to update message:", err);
  }
}

export async function showCurrentQuestion(
  bot: Context["api"],
  chatId: number,
  scopeKey?: string,
): Promise<void> {
  const question = questionManager.getCurrentQuestion(scopeKey);
  const routeContext = questionManager.getRouteContext(scopeKey);
  const threadId = routeContext.threadId;

  if (!question) {
    await showPollSummary(bot, chatId, threadId, scopeKey);
    return;
  }

  logger.debug(`[QuestionHandler] Showing question: ${question.header} - ${question.question}`);

  const text = formatQuestionText(question, scopeKey);
  const keyboard = buildQuestionKeyboard(
    question,
    questionManager.getSelectedOptions(questionManager.getCurrentIndex(scopeKey), scopeKey),
    scopeKey,
  );

  logger.debug(
    `[QuestionHandler] Sending message with keyboard, chatId=${chatId}, threadId=${threadId}`,
  );

  try {
    const message = await bot.sendMessage(chatId, text, {
      reply_markup: keyboard,
      parse_mode: "Markdown",
      message_thread_id: threadId ?? undefined,
    });

    logger.debug(`[QuestionHandler] Message sent, messageId=${message.message_id}`);

    questionManager.addMessageId(message.message_id, scopeKey);
    questionManager.setActiveMessageId(message.message_id, scopeKey);
    syncQuestionInteractionState(
      "callback",
      questionManager.getCurrentIndex(scopeKey),
      questionManager.getActiveMessageId(scopeKey),
      scopeKey,
    );

    summaryAggregator.stopTypingIndicator();
  } catch (err) {
    questionManager.clear(scopeKey);
    clearQuestionInteraction("question_message_send_failed", scopeKey);

    logger.error("[QuestionHandler] Failed to send question message:", err);
    throw err;
  }
}

export async function handleQuestionTextAnswer(ctx: Context): Promise<void> {
  const scopeKey = getInteractionScopeKeyFromContext(ctx);
  const text = ctx.message?.text;
  if (!text) return;

  const currentIndex = questionManager.getCurrentIndex(scopeKey);

  if (!questionManager.isWaitingForCustomInput(currentIndex, scopeKey)) {
    await ctx.reply(t("question.use_custom_button_first"));
    return;
  }

  if (questionManager.hasCustomAnswer(currentIndex, scopeKey)) {
    await ctx.reply(t("question.answer_already_received"));
    return;
  }

  logger.debug(`[QuestionHandler] Custom text answer for question ${currentIndex}: ${text}`);

  questionManager.setCustomAnswer(currentIndex, text, scopeKey);
  questionManager.clearCustomInput(scopeKey);

  // Delete the previous question message
  const activeMessageId = questionManager.getActiveMessageId(scopeKey);
  if (activeMessageId !== null && ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, activeMessageId).catch(() => {});
  }

  // DO NOT send the answer immediately - move to the next question
  // All answers will be sent together after the user answers all questions
  await showNextQuestion(ctx, scopeKey);
}

async function showNextQuestion(ctx: Context, scopeKey?: string): Promise<void> {
  questionManager.nextQuestion(scopeKey);

  if (!ctx.chat) {
    return;
  }

  const threadId = questionManager.getRouteContext(scopeKey).threadId;

  if (questionManager.hasNextQuestion(scopeKey)) {
    await showCurrentQuestion(ctx.api, ctx.chat.id, scopeKey);
  } else {
    await showPollSummary(ctx.api, ctx.chat.id, threadId, scopeKey);
  }
}

async function showPollSummary(
  bot: Context["api"],
  chatId: number,
  threadId: number | null,
  scopeKey?: string,
): Promise<void> {
  const answers = questionManager.getAllAnswers(scopeKey);
  const totalQuestions = questionManager.getTotalQuestions(scopeKey);

  logger.info(
    `[QuestionHandler] Poll completed: ${answers.length}/${totalQuestions} questions answered`,
  );

  // Send all answers to the OpenCode API
  await sendAllAnswersToAgent(bot, chatId, threadId, scopeKey);

  const messageThreadId = threadId ?? undefined;
  if (answers.length === 0) {
    await bot.sendMessage(chatId, t("question.completed_no_answers"), {
      message_thread_id: messageThreadId,
    });
  } else {
    const summary = formatAnswersSummary(answers);
    await bot.sendMessage(chatId, summary, { message_thread_id: messageThreadId });
  }

  clearQuestionInteraction("question_completed", scopeKey);
  questionManager.clear(scopeKey);
  logger.debug("[QuestionHandler] Poll completed and cleared");
}

async function sendAllAnswersToAgent(
  bot: Context["api"],
  chatId: number,
  threadId: number | null,
  scopeKey?: string,
): Promise<void> {
  const currentProject = getCurrentProjectForScope(threadId, chatId);
  const currentSession = getCurrentSessionByThread(threadId, chatId);
  const requestID = questionManager.getRequestID(scopeKey);
  const totalQuestions = questionManager.getTotalQuestions(scopeKey);
  const directory = currentSession?.directory ?? currentProject?.worktree;
  const messageThreadId = threadId ?? undefined;

  if (!directory) {
    logger.error("[QuestionHandler] No project for sending answers");
    await bot.sendMessage(chatId, t("question.no_active_project"), {
      message_thread_id: messageThreadId,
    });
    return;
  }

  if (!requestID) {
    logger.error("[QuestionHandler] No requestID for sending answers");
    await bot.sendMessage(chatId, t("question.no_active_request"), {
      message_thread_id: messageThreadId,
    });
    return;
  }

  // Collect answers for all questions
  // Format: Array<Array<string>> - for each question, an array of strings (selected options)
  const allAnswers: string[][] = [];

  for (let i = 0; i < totalQuestions; i++) {
    const customAnswer = questionManager.getCustomAnswer(i, scopeKey);
    const selectedAnswer = questionManager.getSelectedAnswer(i, scopeKey);

    // Priority: custom answer > selected options
    const answer = customAnswer || selectedAnswer || "";

    if (answer) {
      // Split by newlines if multiple options were selected (in multiple choice mode)
      // Each option is formatted as "* Label: Description"
      const answerParts = answer.split("\n").filter((part) => part.trim());
      allAnswers.push(answerParts);
    } else {
      // Empty answer for unanswered questions
      allAnswers.push([]);
    }
  }

  logger.info(
    `[QuestionHandler] Sending all ${totalQuestions} answers to agent via question.reply: requestID=${requestID}`,
  );
  logger.debug(`[QuestionHandler] Answers payload:`, JSON.stringify(allAnswers, null, 2));

  // CRITICAL: Fire-and-forget! Do not wait for question.reply to complete,
  // otherwise it may block subsequent updates
  safeBackgroundTask({
    taskName: "question.reply",
    task: () =>
      opencodeClient.question.reply({
        requestID,
        directory,
        answers: allAnswers,
      }),
    onSuccess: ({ error }) => {
      if (error) {
        logger.error("[QuestionHandler] Failed to send answers via question.reply:", error);
        void bot
          .sendMessage(chatId, t("question.send_answers_error"), {
            message_thread_id: messageThreadId,
          })
          .catch(() => {});
        return;
      }

      logger.info("[QuestionHandler] All answers sent to agent successfully via question.reply");
    },
  });
}

function formatQuestionText(
  question: {
    header: string;
    question: string;
    multiple?: boolean;
  },
  scopeKey?: string,
): string {
  const currentIndex = questionManager.getCurrentIndex(scopeKey);
  const totalQuestions = questionManager.getTotalQuestions(scopeKey);
  const progressText = totalQuestions > 0 ? `${currentIndex + 1}/${totalQuestions}` : "";

  const headerTitle = [progressText, question.header].filter(Boolean).join(" ");
  const header = headerTitle ? `**${headerTitle}**\n\n` : "";
  const multiple = question.multiple ? t("question.multi_hint") : "";
  return `${header}${question.question}${multiple}`;
}

function buildQuestionKeyboard(
  question: { options: Array<{ label: string; description: string }>; multiple?: boolean },
  selectedOptions: Set<number>,
  scopeKey?: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const questionIndex = questionManager.getCurrentIndex(scopeKey);

  logger.debug(`[QuestionHandler] Building keyboard for question ${questionIndex}`);

  question.options.forEach((option, index) => {
    const isSelected = selectedOptions.has(index);
    const icon = isSelected ? "✅ " : "";
    const buttonText = formatButtonText(option.label, option.description, icon);
    const callbackData = `question:select:${questionIndex}:${index}`;

    logger.debug(`[QuestionHandler] Button ${index}: "${buttonText}" -> "${callbackData}"`);

    keyboard.text(buttonText, callbackData).row();
  });

  if (question.multiple) {
    keyboard.text(t("question.button.submit"), `question:submit:${questionIndex}`).row();
    logger.debug(`[QuestionHandler] Added submit button`);
  }

  keyboard.text(t("question.button.custom"), `question:custom:${questionIndex}`).row();
  logger.debug(`[QuestionHandler] Added custom answer button`);

  keyboard.text(t("question.button.cancel"), `question:cancel:${questionIndex}`);
  logger.debug(`[QuestionHandler] Added cancel button`);

  logger.debug(`[QuestionHandler] Final keyboard: ${JSON.stringify(keyboard.inline_keyboard)}`);

  return keyboard;
}

function formatButtonText(label: string, description: string, icon: string): string {
  let text = `${icon}${label}`;

  if (description && icon === "") {
    text += ` - ${description}`;
  }

  if (text.length > MAX_BUTTON_LENGTH) {
    text = text.substring(0, MAX_BUTTON_LENGTH - 3) + "...";
  }

  return text;
}

function formatAnswersSummary(answers: Array<{ question: string; answer: string }>): string {
  let summary = t("question.summary.title");

  answers.forEach((item, index) => {
    summary += t("question.summary.question", {
      index: index + 1,
      question: item.question,
    });
    summary += t("question.summary.answer", { answer: item.answer });
  });

  return summary;
}
