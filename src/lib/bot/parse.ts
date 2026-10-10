// Turning what the owner typed or tapped into an instruction. Plain code with
// no imports, so it's covered by unit tests (tests/parse.test.mts).

// Ids on the Approve / Edit / Skip buttons. Brief items add the draft id: "approve:<uuid>".
export const BUTTON_IDS = { approve: "approve", edit: "edit", skip: "skip" } as const;

export type Action = keyof typeof BUTTON_IDS;

// A decision about one particular draft: a button on a brief item ("approve:<id>"),
// or a typed "APPROVE 2" / "EDIT 2" / "SKIP 2" (item 2 of the latest brief).
export type TargetedAction = { action: Action; draftId?: string; briefNumber?: number };

export function parseButtonPayload(payload: string | undefined) {
  const m = payload?.match(/^(approve|edit|skip):([0-9a-f-]{36})$/);
  return m ? { action: m[1] as Action, draftId: m[2] } : null;
}

export function parseTargetedAction(buttonPayload: string | undefined, body: string): TargetedAction | null {
  const button = parseButtonPayload(buttonPayload);
  if (button) return { action: button.action, draftId: button.draftId };
  const typed = body.trim().toUpperCase().match(/^(APPROVE|EDIT|SKIP)\s*#?(\d{1,2})[.!]?$/);
  if (typed) return { action: typed[1].toLowerCase() as Action, briefNumber: Number(typed[2]) };
  return null;
}

// A tapped button on the draft on screen, or a typed 1/2/3 or approve/edit/skip.
export function parseAction(buttonPayload: string | undefined, body: string): Action | null {
  if (buttonPayload === BUTTON_IDS.approve) return "approve";
  if (buttonPayload === BUTTON_IDS.edit) return "edit";
  if (buttonPayload === BUTTON_IDS.skip) return "skip";
  const t = body.trim().toLowerCase().replace(/[.!]$/, "");
  if (t === "1" || t === "approve") return "approve";
  if (t === "2" || t === "edit") return "edit";
  if (t === "3" || t === "skip") return "skip";
  return null;
}

export type Command =
  | { name: "help" | "status" | "pause" | "resume" | "time_off" | "test_send" | "test_checker" }
  | { name: "run_brief" | "run_report" | "approve_all" | "undo" }
  | { name: "new_review"; rating: number | null }
  | { name: "run_reviews" | "run_posts" | "queue" | "next" }
  | { name: "time"; hhmm: string; plusDays: number }
  | { name: "cap"; percent: number }
  | { name: "set_reward"; reward: string }
  | { name: "reward" | "qr" | "birthday_campaign" | "campaign_results" | "which_report" }
  | { name: "my_email"; email: string }
  | { name: "reset_onboarding" }
  | { name: "export_customers" | "email_previews" | "run_feedback" };

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// Exact typed commands. Anything else is treated as normal chat.
// todayWeekday (0 = Sunday, London) is for "TIME THURSDAY 18:00".
export function parseCommand(body: string, todayWeekday: number): Command | null {
  // "set sign-up reward to a free mango lassi" (keeps the owner's wording)
  const reward = body.trim().match(/^set\s+(?:the\s+)?sign[\s-]?up\s+reward\s*(?:to|:|=)\s*(.+?)[.!]?$/i);
  if (reward && reward[1].trim()) return { name: "set_reward", reward: reward[1].trim().slice(0, 100) };

  const t = body.trim().toUpperCase().replace(/\s+/g, " ");
  if (t === "REWARD" || t === "SIGNUP REWARD" || t === "SIGN-UP REWARD") return { name: "reward" };
  if (t === "QR" || t === "QR CODE" || t === "SIGNUP LINK" || t === "SIGN-UP LINK") return { name: "qr" };
  if (t === "HELP" || t === "COMMANDS") return { name: "help" };
  if (t === "STATUS") return { name: "status" };
  if (t === "PAUSE") return { name: "pause" };
  if (t === "RESUME") return { name: "resume" };
  if (t === "TEST SEND") return { name: "test_send" };
  if (t === "TEST CHECKER") return { name: "test_checker" };
  if (t === "RUN BRIEF" || t === "BRIEF") return { name: "run_brief" };
  // WEEKLY was the old Sunday round-up; the Monday report replaced it.
  if (t === "RUN REPORT" || t === "WEEKLY" || t === "WEEKLY REPORT") return { name: "run_report" };
  if (/^APPROVE ALL[.!]?$/.test(t)) return { name: "approve_all" };
  if (t === "UNDO" || t === "UNDO!") return { name: "undo" };
  const newReview = t.match(/^NEW REVIEW(?: ([1-5])(?: ?STARS?)?)?$/);
  if (newReview) return { name: "new_review", rating: newReview[1] ? Number(newReview[1]) : null };
  if (t === "RUN REVIEWS") return { name: "run_reviews" };
  if (t === "RUN POSTS") return { name: "run_posts" };
  if (t === "QUEUE") return { name: "queue" };
  if (t === "NEXT") return { name: "next" };
  if (/^TIME (OFF|NOW|RESET|REAL)$/.test(t)) return { name: "time_off" };
  // "TIME 22:00", "TIME TOMORROW 09:05", "TIME THURSDAY 18:00" (the next Thursday, or today if it's Thursday)
  const time = t.match(/^TIME (?:(TOMORROW|MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z]* )?(\d{1,2})[:.](\d{2})$/);
  if (time && Number(time[2]) < 24 && Number(time[3]) < 60) {
    let plusDays = 0;
    if (time[1] === "TOMORROW") plusDays = 1;
    else if (time[1]) plusDays = (WEEKDAYS.indexOf(time[1]) - todayWeekday + 7) % 7;
    return { name: "time", hhmm: `${time[2]}:${time[3]}`, plusDays };
  }
  const email = body.trim().match(/^my\s+email(?:\s+is)?\s*:?\s+(\S+@\S+\.\S+)$/i);
  if (email) return { name: "my_email", email: email[1].toLowerCase() };
  if (t === "RESET ONBOARDING" || t === "RESET SETUP") return { name: "reset_onboarding" };
  if (/^EXPORT( MY)? (CUSTOMERS|CUSTOMER LIST|LIST)$/.test(t)) return { name: "export_customers" };
  if (t === "EMAIL PREVIEWS" || t === "EMAIL PREVIEW" || t === "PREVIEW EMAILS") return { name: "email_previews" };
  if (t === "RUN FEEDBACK") return { name: "run_feedback" };
  if (t === "BIRTHDAY CAMPAIGN") return { name: "birthday_campaign" };
  if (t === "CAMPAIGN RESULTS" || t === "CAMPAIGN RESULT" || t === "CAMPAIGN REPORT") return { name: "campaign_results" };
  // REPORT on its own was easy to confuse with RUN REPORT, so it asks which one.
  if (t === "REPORT") return { name: "which_report" };
  const cap = t.match(/^CAP (\d{1,3})%?$/);
  if (cap && Number(cap[1]) <= 100) return { name: "cap", percent: Number(cap[1]) };
  return null;
}
