export type ScheduleStatus = "active" | "paused" | "completed";

export type WeeklyDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ScheduleRule =
  | {
      type: "once";
      runAt: string;
    }
  | {
      type: "recurring_daily";
      time: string;
    }
  | {
      type: "recurring_weekly";
      dayOfWeek: WeeklyDay;
      time: string;
    }
  | {
      type: "recurring_monthly";
      dayOfMonth: number;
      time: string;
    }
  | {
      type: "recurring_yearly";
      month: number;
      day: number;
      time: string;
    };

export interface ScheduledTaskScope {
  chatId: number;
  threadId: number | null;
  sessionId: string;
  sessionTitle: string;
  directory: string;
}

export interface ScheduledTask {
  id: string;
  prompt: string;
  scope: ScheduledTaskScope;
  rule: ScheduleRule;
  status: ScheduleStatus;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastError?: string;
  runCount: number;
}

export type CreateScheduledTaskInput = {
  prompt: string;
  scope: ScheduledTaskScope;
  rule: ScheduleRule;
};
