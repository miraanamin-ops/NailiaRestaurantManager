// The test tools: test commands (TIME, TEST SEND, NEW REVIEW, the RUN commands...)
// and the TIME test clock. They work only with TEST_TOOLS on (lib/switches.ts),
// and only ever on a demo restaurant. No imports beyond lib/switches.ts, so it's unit-tested.
import { testToolsFor, testToolsSwitch } from "./switches";

// TEST_TOOLS is on for this deployment (it still acts only on demo restaurants: use testToolsOn).
export function testToolsEnabled() {
  return testToolsSwitch(process.env).on;
}

// Test tools may act on this restaurant: TEST_TOOLS is on and it's a demo restaurant.
export function testToolsOn(restaurant: { is_demo?: boolean | null }) {
  return testToolsFor(process.env, restaurant);
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
  "sample_z",
  "test_z",
  "run_weather",
]);

export function isTestCommand(name: string) {
  return TEST_COMMANDS.has(name);
}

export const TEST_TOOLS_OFF_MESSAGE =
  "🧪 That's a test command, and test tools are off, so nothing happened. (The builder can turn them on with the TEST_TOOLS setting.)";

export const TEST_TOOLS_REAL_RESTAURANT_MESSAGE =
  "🧪 That's a test command. Test commands only work for demo restaurants, so nothing happened.";
