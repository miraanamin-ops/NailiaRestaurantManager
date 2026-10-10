// TEST_MODE=true turns on the test commands (TIME, TEST SEND, NEW REVIEW, the
// RUN commands...) and the TIME test clock. Off unless set, so it's off in
// production by default. No imports, so it's unit-tested.

export function isTestMode() {
  return process.env.TEST_MODE === "true";
}

// The commands that only exist for testing (names from lib/bot/parse.ts).
export const TEST_COMMANDS = new Set([
  "time",
  "time_off",
  "test_send",
  "test_checker",
  "new_review",
  "run_reviews",
  "run_posts",
  "run_brief",
  "run_report",
  "reset_onboarding",
  "run_feedback",
]);

export function isTestCommand(name: string) {
  return TEST_COMMANDS.has(name);
}

export const TEST_MODE_OFF_MESSAGE =
  "🧪 That's a test command, and test mode is off, so nothing happened. (The builder can turn test mode on with the TEST_MODE setting.)";
