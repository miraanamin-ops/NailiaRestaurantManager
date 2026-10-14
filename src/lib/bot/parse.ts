// Turning what the owner typed or tapped into an instruction. Plain code with
// no imports, so it's covered by unit tests (tests/parse.test.mts).

// Ids on the Approve / Edit / Skip buttons. Brief items add the draft id: "approve:<uuid>".
export const BUTTON_IDS = { approve: "approve", edit: "edit", skip: "skip" } as const;

export type Action = keyof typeof BUTTON_IDS;

// A decision about one particular draft: a button on a brief item ("approve:<id>"),
// or a typed "APPROVE 2" / "EDIT 2" / "SKIP 2" (item 2 of the latest brief).
export type TargetedAction = { action: Action; draftId?: string; briefNumber?: number };

// A question about a review (e.g. it alleges food poisoning): Reply publicly /
// Handle privately / Both. The buttons carry the question's id ("public:<uuid>");
// typed "PUBLIC 2" answers brief item 2; "public", "private(ly)" or "both" (or 1/2/3)
// answer the question on screen.
export const QUESTION_IDS = { public: "public", private: "private", both: "both" } as const;
export type QuestionChoice = keyof typeof QUESTION_IDS;
export type QuestionAnswer = { choice: QuestionChoice; draftId?: string; briefNumber?: number };

const CHOICE_WORDS: Record<string, QuestionChoice> = {
  "1": "public",
  public: "public",
  "reply publicly": "public",
  publicly: "public",
  "2": "private",
  private: "private",
  privately: "private",
  "handle privately": "private",
  "3": "both",
  both: "both",
};

// onScreen: a question is the draft on screen, so plain words and 1/2/3 count.
export function parseQuestionAnswer(buttonPayload: string | undefined, body: string, onScreen: boolean): QuestionAnswer | null {
  const button = buttonPayload?.match(/^(public|private|both):([0-9a-f-]{36})$/);
  if (button) return { choice: button[1] as QuestionChoice, draftId: button[2] };
  const typed = body.trim().toUpperCase().match(/^(PUBLIC|PRIVATE|BOTH)\s*#?(\d{1,2})[.!]?$/);
  if (typed) return { choice: typed[1].toLowerCase() as QuestionChoice, briefNumber: Number(typed[2]) };
  if (!onScreen) return null;
  const word = CHOICE_WORDS[body.trim().toLowerCase().replace(/[.!]$/, "")];
  return word ? { choice: word } : null;
}

// A question about special hours (a bank holiday coming up): Same hours / Closed /
// Different hours. Buttons carry the question's id ("same:<uuid>"); typed "SAME 2",
// "CLOSED 2" or "DIFFERENT 2" answer brief item 2; plain words or 1/2/3 answer the
// question on screen.
export const HOURS_IDS = { same: "same", closed: "closed", different: "different" } as const;
export type HoursChoice = keyof typeof HOURS_IDS;
export type HoursAnswer = { choice: HoursChoice; draftId?: string; briefNumber?: number };

const HOURS_WORDS: Record<string, HoursChoice> = {
  "1": "same",
  same: "same",
  "same hours": "same",
  "usual hours": "same",
  "2": "closed",
  closed: "closed",
  "3": "different",
  different: "different",
  "different hours": "different",
};

export function parseHoursAnswer(buttonPayload: string | undefined, body: string, onScreen: boolean): HoursAnswer | null {
  const button = buttonPayload?.match(/^(same|closed|different):([0-9a-f-]{36})$/);
  if (button) return { choice: button[1] as HoursChoice, draftId: button[2] };
  const typed = body.trim().toUpperCase().match(/^(SAME|CLOSED|DIFFERENT)\s*#?(\d{1,2})[.!]?$/);
  if (typed) return { choice: typed[1].toLowerCase() as HoursChoice, briefNumber: Number(typed[2]) };
  if (!onScreen) return null;
  const word = HOURS_WORDS[body.trim().toLowerCase().replace(/[.!]$/, "")];
  return word ? { choice: word } : null;
}

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
  | { name: "export_customers" | "email_previews" | "run_feedback" }
  | { name: "add_staff" | "remove_staff"; number: string }
  | { name: "staff" | "sales" | "run_weather" }
  | { name: "sample_z" | "test_z"; sample: ZSample };

// The sample till reports (public/samples/): 1-3 read cleanly, "bad" is blurred and cut off.
export const Z_SAMPLES = ["1", "2", "3", "bad"] as const;
export type ZSample = (typeof Z_SAMPLES)[number];

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
  // Staff numbers: "ADD STAFF +447700900123", "REMOVE STAFF 07700 900123", "STAFF"
  const staff = t.match(/^(ADD|REMOVE|DELETE) STAFF(?: NUMBER)?:? ([+\d][\d ()-]{6,})$/);
  if (staff) return { name: staff[1] === "ADD" ? "add_staff" : "remove_staff", number: staff[2].trim() };
  if (t === "STAFF" || t === "STAFF NUMBERS" || t === "MY STAFF") return { name: "staff" };
  if (t === "SALES" || t === "UPLOAD SALES" || t === "SALES PAGE") return { name: "sales" };
  if (t === "RUN WEATHER" || t === "WEATHER") return { name: "run_weather" };
  // "SAMPLE ZREPORT 2" sends you sample till report 2 to forward back; "TEST ZREPORT BAD" pretends you just sent it.
  const z = t.match(/^(SAMPLE|TEST) Z(?:[- ]?REPORT)?(?: (\d|BAD))?$/);
  if (z && (!z[2] || (Z_SAMPLES as readonly string[]).includes(z[2].toLowerCase()))) {
    return { name: z[1] === "SAMPLE" ? "sample_z" : "test_z", sample: (z[2]?.toLowerCase() ?? "1") as ZSample };
  }
  if (t === "BIRTHDAY CAMPAIGN") return { name: "birthday_campaign" };
  if (t === "CAMPAIGN RESULTS" || t === "CAMPAIGN RESULT" || t === "CAMPAIGN REPORT") return { name: "campaign_results" };
  // REPORT on its own was easy to confuse with RUN REPORT, so it asks which one.
  if (t === "REPORT") return { name: "which_report" };
  const cap = t.match(/^CAP (\d{1,3})%?$/);
  if (cap && Number(cap[1]) <= 100) return { name: "cap", percent: Number(cap[1]) };
  return null;
}

// A question about the restaurant's numbers ("how was last week?", "how did
// Saturday compare?", "what sold best?"). Until the GM router (phase 4), this is
// how an owner's message reaches Insights. A request for something to be written
// ("Thursday is quiet, draft an offer") isn't one: that stays with the assistant.
const NUMBER_WORDS =
  /\b(sales|sold|sell(?:s|ing)?|takings?|took|take|made|make|revenue|turnover|money|earn(?:t|ed)?|covers|bills?|transactions?|spend|spent|busy|busiest|quiet(?:est)?|dead|slow(?:est)?|best ?sellers?|popular|margins?|profit|rating|stars?|reviews?|sign[- ]?ups?|signed up|joined|email list|campaign|offer|deal|redeem\w*|weather|rain\w*|numbers|figures|compare[ds]?|week|weekend|month|yesterday|last night|staff|(?:mon|tues|wednes|thurs|fri|satur|sun)days?)\b/i;
// Opening hours and other profile questions aren't about the numbers.
const NOT_NUMBERS = /\b(open|opening|close|closing|hours|menu|address|allergens?|halal)\b/i;
const ASKING = /\?|^(how|what|whats|what's|which|when|did|was|were|is|are|do|does|have|has|should|can|could|compare|any)\b|\b(how (?:was|were|did|much|many|is|are|does)|compare[ds]?|vs\.?|versus|than|last (?:week|month|year|night)|yesterday|this (?:week|month))\b/i;
const WRITING = /\b(draft|write|reply|respond|post|send|email them|make (?:an? )?(?:offer|post|campaign)|create|set up|change|add|remove|update)\b/i;
// "Thursday is quiet" (step 6) asks for an offer to fill it, not for figures.
const QUIET_REQUEST = /\b(is|are|gonna be|will be|always|usually|tends to be|looks)\s+(?:so |really |very |a bit |always )?(quiet|dead|slow)\b/i;

export function looksLikeNumbersQuestion(text: string) {
  const t = text.trim();
  if (!t || t.length > 300) return false;
  if (WRITING.test(t) || NOT_NUMBERS.test(t) || (QUIET_REQUEST.test(t) && !/\?/.test(t))) return false;
  return NUMBER_WORDS.test(t) && ASKING.test(t);
}

// The GM's own cards: "which did you mean?" (choose:<id>:<n>, or a typed 1 to 3
// while it's on screen), a special idea (like:<id> / skipidea:<id>, or a typed
// LIKE / SKIP), and one-tap skip reasons (reason:<id>:<n>).
export type GmTap =
  | { kind: "choose"; draftId?: string; n: number }
  | { kind: "idea"; draftId?: string; like: boolean }
  | { kind: "reason"; draftId: string; n: number };

export function parseGmTap(payload: string | undefined, body: string, onScreen: string | null): GmTap | null {
  const choose = payload?.match(/^choose:([0-9a-f-]{36}):([1-3])$/);
  if (choose) return { kind: "choose", draftId: choose[1], n: Number(choose[2]) };
  const idea = payload?.match(/^(like|skipidea):([0-9a-f-]{36})$/);
  if (idea) return { kind: "idea", draftId: idea[2], like: idea[1] === "like" };
  const reason = payload?.match(/^reason:([0-9a-f-]{36}):([1-3])$/);
  if (reason) return { kind: "reason", draftId: reason[1], n: Number(reason[2]) };
  if (payload) return null;
  const t = body.trim().toLowerCase().replace(/[.!]$/, "");
  if (onScreen === "choice" && /^[1-3]$/.test(t)) return { kind: "choose", n: Number(t) };
  if (onScreen === "special_idea" && /^(like|like it|skip)$/.test(t)) return { kind: "idea", like: t !== "skip" };
  return null;
}
