import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldEscalateSilentTaskFailure, silentTaskFailureThreshold } from "./task-failure-streaks.js";

test("silent task failure thresholds distinguish frequent and daily tasks", () => {
  assert.equal(silentTaskFailureThreshold(false), 12);
  assert.equal(silentTaskFailureThreshold(true), 3);
});

test("frequent silent tasks escalate at one hour, then every five threshold windows", () => {
  const threshold = silentTaskFailureThreshold(false);
  assert.equal(shouldEscalateSilentTaskFailure(11, threshold), false);
  assert.equal(shouldEscalateSilentTaskFailure(12, threshold), true);
  assert.equal(shouldEscalateSilentTaskFailure(13, threshold), false);
  assert.equal(shouldEscalateSilentTaskFailure(59, threshold), false);
  assert.equal(shouldEscalateSilentTaskFailure(60, threshold), true);
  assert.equal(shouldEscalateSilentTaskFailure(120, threshold), true);
});

test("daily silent tasks escalate on three failures, then every five threshold windows", () => {
  const threshold = silentTaskFailureThreshold(true);
  assert.equal(shouldEscalateSilentTaskFailure(2, threshold), false);
  assert.equal(shouldEscalateSilentTaskFailure(3, threshold), true);
  assert.equal(shouldEscalateSilentTaskFailure(4, threshold), false);
  assert.equal(shouldEscalateSilentTaskFailure(14, threshold), false);
  assert.equal(shouldEscalateSilentTaskFailure(15, threshold), true);
  assert.equal(shouldEscalateSilentTaskFailure(30, threshold), true);
});
