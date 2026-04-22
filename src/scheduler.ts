/**
 * scheduler.ts — intentionally empty.
 *
 * All cron schedules have moved to /home/pi/pi-scheduler/index.js.
 * pi-scheduler calls http://127.0.0.1:3099/run-task with the task name,
 * and BanterAgent executes the task via task-runner.ts.
 *
 * startScheduler() is kept so index.ts doesn't need changes.
 */
export function startScheduler(): void {
  console.log("⏰ Scheduler: crons managed by pi-scheduler (external). Task runner ready.");
}
