import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests (npm test). No database, no network: anything that would talk to
// Supabase, Twilio or Claude is replaced with a stand-in inside each test.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url)).replaceAll("\\", "/");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${here("./src/")}` },
      // Next.js blocks server code from reaching the browser with this import; in tests it's a no-op.
      { find: /^server-only$/, replacement: here("./tests/support/empty.ts") },
    ],
  },
  test: {
    include: ["tests/**/*.test.{ts,mts}"],
    environment: "node",
    restoreMocks: true,
  },
});
