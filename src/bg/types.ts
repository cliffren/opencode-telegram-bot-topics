export type BgTaskStatus = "queued" | "running" | "succeeded" | "failed";

export type BgPostActionType = "none" | "summarize" | "custom";

export type BgPostActionStatus = "pending" | "sent" | "failed";

export type BgPostAction =
  | { type: "none" }
  | { type: "summarize" }
  | { type: "custom"; prompt: string };

export interface BgTaskScope {
  chatId: number;
  threadId: number | null;
  sessionId: string;
  directory: string;
}

export interface BgTask {
  id: string;
  token: string;
  title: string;
  prompt: string;
  scope: BgTaskScope;
  status: BgTaskStatus;
  postAction: BgPostAction;
  postActionStatus: BgPostActionStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  pid?: number;
  logPath?: string;
  summary?: string;
  notificationSentAt?: string;
  postActionSentAt?: string;
  postActionError?: string;
}

export interface BgTaskCreateInput {
  title: string;
  prompt: string;
  scope: BgTaskScope;
  postAction: BgPostAction;
}

export interface BgNotifyInput {
  taskId: string;
  token: string;
  status: "started" | "done" | "failed";
  title?: string;
  summary?: string;
  pid?: number;
  logPath?: string;
}
