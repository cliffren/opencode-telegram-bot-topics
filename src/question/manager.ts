import { Question, QuestionState, QuestionAnswer } from "./types.js";
import { logger } from "../utils/logger.js";

function createEmptyState(): QuestionState {
  return {
    questions: [],
    currentIndex: 0,
    selectedOptions: new Map(),
    customAnswers: new Map(),
    customInputQuestionIndex: null,
    activeMessageId: null,
    messageIds: [],
    isActive: false,
    requestID: null,
    sessionId: null,
    chatId: null,
    threadId: null,
  };
}

class QuestionManager {
  private states = new Map<string, QuestionState>();

  private getScopeKey(chatId: number | null, threadId: number | null): string {
    return `${chatId ?? "none"}:${threadId ?? "private"}`;
  }

  private resolveScopeKey(scopeKey?: string): string {
    return scopeKey ?? this.getScopeKey(null, null);
  }

  private getState(scopeKey?: string): QuestionState {
    return this.states.get(this.resolveScopeKey(scopeKey)) ?? createEmptyState();
  }

  private setState(state: QuestionState, scopeKey?: string): void {
    this.states.set(this.resolveScopeKey(scopeKey), state);
  }

  startQuestions(
    questions: Question[],
    requestID: string,
    routeContext?: { sessionId?: string | null; chatId?: number | null; threadId?: number | null },
  ): void {
    const scopeKey = this.getScopeKey(routeContext?.chatId ?? null, routeContext?.threadId ?? null);
    const currentState = this.getState(scopeKey);
    logger.debug(
      `[QuestionManager] startQuestions called: isActive=${currentState.isActive}, currentQuestions=${currentState.questions.length}, newQuestions=${questions.length}, requestID=${requestID}`,
    );

    if (currentState.isActive) {
      logger.info(`[QuestionManager] Poll already active! Forcing reset before starting new poll.`);
      this.clear(scopeKey);
    }

    logger.info(
      `[QuestionManager] Starting new poll with ${questions.length} questions, requestID=${requestID}`,
    );
    this.setState(
      {
        questions,
        currentIndex: 0,
        selectedOptions: new Map(),
        customAnswers: new Map(),
        customInputQuestionIndex: null,
        activeMessageId: null,
        messageIds: [],
        isActive: true,
        requestID,
        sessionId: routeContext?.sessionId ?? null,
        chatId: routeContext?.chatId ?? null,
        threadId: routeContext?.threadId ?? null,
      },
      scopeKey,
    );
  }

  getRequestID(scopeKey?: string): string | null {
    return this.getState(scopeKey).requestID;
  }

  getSessionID(scopeKey?: string): string | null {
    return this.getState(scopeKey).sessionId;
  }

  getRouteContext(scopeKey?: string): { chatId: number | null; threadId: number | null } {
    const state = this.getState(scopeKey);
    return {
      chatId: state.chatId,
      threadId: state.threadId,
    };
  }

  getCurrentQuestion(scopeKey?: string): Question | null {
    const state = this.getState(scopeKey);
    if (state.currentIndex >= state.questions.length) {
      return null;
    }
    return state.questions[state.currentIndex];
  }

  selectOption(questionIndex: number, optionIndex: number, scopeKey?: string): void {
    const state = this.getState(scopeKey);
    if (!state.isActive) {
      return;
    }

    const question = state.questions[questionIndex];
    if (!question) {
      return;
    }

    const selected = state.selectedOptions.get(questionIndex) || new Set();

    if (question.multiple) {
      if (selected.has(optionIndex)) {
        selected.delete(optionIndex);
      } else {
        selected.add(optionIndex);
      }
    } else {
      selected.clear();
      selected.add(optionIndex);
    }

    state.selectedOptions.set(questionIndex, selected);
    this.setState(state, scopeKey);

    logger.debug(
      `[QuestionManager] Selected options for question ${questionIndex}: ${Array.from(selected).join(", ")}`,
    );
  }

  getSelectedOptions(questionIndex: number, scopeKey?: string): Set<number> {
    return this.getState(scopeKey).selectedOptions.get(questionIndex) || new Set();
  }

  getSelectedAnswer(questionIndex: number, scopeKey?: string): string {
    const state = this.getState(scopeKey);
    const question = state.questions[questionIndex];
    if (!question) {
      return "";
    }

    const selected = state.selectedOptions.get(questionIndex) || new Set();
    const options = Array.from(selected)
      .map((idx) => question.options[idx])
      .filter((opt) => opt)
      .map((opt) => `* ${opt.label}: ${opt.description}`);

    return options.join("\n");
  }

  setCustomAnswer(questionIndex: number, answer: string, scopeKey?: string): void {
    const state = this.getState(scopeKey);
    logger.debug(
      `[QuestionManager] Custom answer received for question ${questionIndex}: ${answer}`,
    );
    state.customAnswers.set(questionIndex, answer);
    this.setState(state, scopeKey);
  }

  getCustomAnswer(questionIndex: number, scopeKey?: string): string | undefined {
    return this.getState(scopeKey).customAnswers.get(questionIndex);
  }

  hasCustomAnswer(questionIndex: number, scopeKey?: string): boolean {
    return this.getState(scopeKey).customAnswers.has(questionIndex);
  }

  nextQuestion(scopeKey?: string): void {
    const state = this.getState(scopeKey);
    state.currentIndex++;
    state.customInputQuestionIndex = null;
    state.activeMessageId = null;
    this.setState(state, scopeKey);

    logger.debug(
      `[QuestionManager] Moving to next question: ${state.currentIndex}/${state.questions.length}`,
    );
  }

  hasNextQuestion(scopeKey?: string): boolean {
    const state = this.getState(scopeKey);
    return state.currentIndex < state.questions.length;
  }

  getCurrentIndex(scopeKey?: string): number {
    return this.getState(scopeKey).currentIndex;
  }

  getTotalQuestions(scopeKey?: string): number {
    return this.getState(scopeKey).questions.length;
  }

  addMessageId(messageId: number, scopeKey?: string): void {
    const state = this.getState(scopeKey);
    state.messageIds.push(messageId);
    this.setState(state, scopeKey);
  }

  setActiveMessageId(messageId: number, scopeKey?: string): void {
    const state = this.getState(scopeKey);
    state.activeMessageId = messageId;
    this.setState(state, scopeKey);
  }

  getActiveMessageId(scopeKey?: string): number | null {
    return this.getState(scopeKey).activeMessageId;
  }

  isActiveMessage(messageId: number | null, scopeKey?: string): boolean {
    const state = this.getState(scopeKey);
    return state.isActive && state.activeMessageId !== null && messageId === state.activeMessageId;
  }

  startCustomInput(questionIndex: number, scopeKey?: string): void {
    const state = this.getState(scopeKey);
    if (!state.isActive || !state.questions[questionIndex]) {
      return;
    }

    state.customInputQuestionIndex = questionIndex;
    this.setState(state, scopeKey);
  }

  clearCustomInput(scopeKey?: string): void {
    const state = this.getState(scopeKey);
    state.customInputQuestionIndex = null;
    this.setState(state, scopeKey);
  }

  isWaitingForCustomInput(questionIndex: number, scopeKey?: string): boolean {
    return this.getState(scopeKey).customInputQuestionIndex === questionIndex;
  }

  getMessageIds(scopeKey?: string): number[] {
    return [...this.getState(scopeKey).messageIds];
  }

  isActive(scopeKey?: string): boolean {
    const state = this.getState(scopeKey);
    logger.debug(
      `[QuestionManager] isActive check: ${state.isActive}, questions=${state.questions.length}, currentIndex=${state.currentIndex}`,
    );
    return state.isActive;
  }

  cancel(scopeKey?: string): void {
    const state = this.getState(scopeKey);
    logger.info("[QuestionManager] Poll cancelled");
    state.isActive = false;
    state.customInputQuestionIndex = null;
    state.activeMessageId = null;
    this.setState(state, scopeKey);
  }

  clear(scopeKey?: string): void {
    this.states.set(this.resolveScopeKey(scopeKey), createEmptyState());
  }

  getAllAnswers(scopeKey?: string): QuestionAnswer[] {
    const state = this.getState(scopeKey);
    const answers: QuestionAnswer[] = [];

    for (let i = 0; i < state.questions.length; i++) {
      const question = state.questions[i];
      const selectedAnswer = this.getSelectedAnswer(i, scopeKey);
      const customAnswer = this.getCustomAnswer(i, scopeKey);

      const finalAnswer = customAnswer || selectedAnswer;

      if (finalAnswer) {
        answers.push({
          question: question.question,
          answer: finalAnswer,
        });
      }
    }

    return answers;
  }
}

export const questionManager = new QuestionManager();
