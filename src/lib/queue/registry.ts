import type { QueueJob } from "./store";

// What runs each type of job. Register new types (forecast, rota, finance...) in
// lib/queue/handlers.ts, after adding their row to job_types.
export type JobHandler = {
  // Does the work. Throwing means "failed": it's retried after a wait (1, 5, 15,
  // then 60 minutes) until it has used its attempts, then it's dead. Throw a
  // PermanentJobError to skip the retries. What it returns is saved on the job.
  run(job: QueueJob): Promise<Record<string, unknown> | void>;
  // Called once when the job dies (also when its worker crashed on the last try).
  onDead?(job: QueueJob, error: unknown): Promise<void>;
  // false: onDead tells the builder itself (default: the worker does).
  alertOnDead?: boolean;
  // Also tell the builder about the first failed attempt (the morning job does).
  alertFirstFailure?: boolean;
};

// A failure that retrying can't fix (e.g. an agent's answer was invalid twice).
export class PermanentJobError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PermanentJobError";
  }
}
