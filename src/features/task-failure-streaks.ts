const FREQUENT_TASK_FAILURE_THRESHOLD = 12;
const DAILY_TASK_FAILURE_THRESHOLD = 3;

export function silentTaskFailureThreshold(isDailyTask: boolean): number {
  return isDailyTask ? DAILY_TASK_FAILURE_THRESHOLD : FREQUENT_TASK_FAILURE_THRESHOLD;
}

export function shouldEscalateSilentTaskFailure(consecutiveFailures: number, threshold: number): boolean {
  if (consecutiveFailures <= 0) return false;
  if (consecutiveFailures === threshold) return true;
  return consecutiveFailures > threshold && consecutiveFailures % (5 * threshold) === 0;
}
