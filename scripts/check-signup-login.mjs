// Checks the straight-in login after sign-up (lib/auth.ts startSignupSession) against
// the real Supabase Auth of the DEV project, step by step, then removes what it made:
//   1. generateLink for a brand-new email (no email is sent) makes a fresh login account
//   2. verifyOtp with its token hash gives a session (as /auth/verify does)
//   3. that session's access token carries a session id, and Supabase accepts the token
//   4. a second generateLink for the same email is no longer a fresh account
//
//   node --env-file=.env.local scripts/check-signup-login.mjs
//
// Dev only: refuses the live database whatever the flags.
import { createClient } from "@supabase/supabase-js";
import { refuseLive } from "./lib/live-guard.mjs";

refuseLive(process.env, "check-signup-login", "makes and removes a test login account");
const { SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY?.startsWith("sb_") || !SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_")) {
  console.error("Needs the dev project's SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const browser = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const email = `signup-check-${Date.now()}@example.com`;
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => {
  console.error(`✗ ${m}`);
  process.exitCode = 1;
};
// One line per check: ✓ with what passed, or ✗ with what went wrong.
const expectThat = (passed, okText, failText) => (passed ? ok(okText) : fail(failText));
const sessionIdOf = (token) => {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).session_id ?? null;
  } catch {
    return null;
  }
};

let userId = null;
try {
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw new Error(`generateLink: ${link.error.message}`);
  userId = link.data.user.id;
  const age = Date.now() - Date.parse(link.data.user.created_at);
  expectThat(age < 120_000 && !link.data.user.last_sign_in_at, `generateLink made a fresh account (${Math.round(age / 1000)}s old, never signed in)`, `not a fresh account: ${JSON.stringify(link.data.user).slice(0, 200)}`);
  expectThat(link.data.properties?.hashed_token, "it returned a token hash", "no token hash");

  const verified = await browser.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (verified.error || !verified.data.session) throw new Error(`verifyOtp: ${verified.error?.message ?? "no session"}`);
  ok("verifyOtp with type email gave a session");

  const token = verified.data.session.access_token;
  const sessionId = sessionIdOf(token);
  expectThat(sessionId, `the access token carries a session id (${sessionId?.slice(0, 8)}…)`, "no session_id in the access token");
  const user = await browser.auth.getUser(token);
  expectThat(user.data.user?.email === email, "Supabase accepts the token (getUser) for the right email", `getUser: ${user.error?.message}`);

  const again = await admin.auth.admin.generateLink({ type: "magiclink", email });
  expectThat(again.data?.user?.last_sign_in_at, "the same email a second time is no longer a fresh account (it has signed in)", "the second link still looks fresh");
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    error ? fail(`couldn't remove the test account ${email}: ${error.message}`) : ok("removed the test account");
  }
}
