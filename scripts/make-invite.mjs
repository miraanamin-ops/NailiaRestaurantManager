// Makes an invite code for the sign-up page (/start?invite=CODE).
// Usage: node --env-file=.env.local scripts/make-invite.mjs [CODE] [uses] [note]
//   e.g. node --env-file=.env.local scripts/make-invite.mjs PHONE-TEST 10 "phone test of Dina"
// Without a code, one is made up. Refuses the live database unless run with --live.
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { guardLive, withoutLiveFlag } from "./lib/live-guard.mjs";

guardLive(process.env, "make-invite");
const [codeArg, usesArg, note] = withoutLiveFlag(process.argv.slice(2));
const code = (codeArg ?? `TRY-${randomBytes(3).toString("hex")}`).trim().toUpperCase();
const uses = Number(usesArg ?? 5);
if (!/^[A-Z0-9-]{4,40}$/.test(code)) throw new Error("A code is 4 to 40 letters, digits or dashes");
if (!Number.isInteger(uses) || uses < 1 || uses > 100) throw new Error("Uses must be 1 to 100");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const { error } = await supabase.from("pilot_invites").insert({ code, max_uses: uses, used_count: 0, active: true, note: note ?? "made with scripts/make-invite.mjs", type: "pilot" });
if (error) throw new Error(error.message);
console.log(`Invite code ${code} (${uses} sign-ups): /start?invite=${code}`);
