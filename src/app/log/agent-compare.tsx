import { check, type Draft } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import { PHOTO_TIPS, type PhotoReason } from "@/lib/agents/visibility-rules";
import { ROUTE_WORDS, type Route } from "@/lib/agents/gm-rules";

// The shadow comparison (builder only), for any agent: for each piece of work,
// what today's code produced, what the agent would have produced, and the
// checker's verdict, side by side. This is what decides when a restaurant
// switches an agent to live.

export type CompareAgent = "reputation" | "visibility" | "insights" | "growth" | "gm";

type ShadowRow = {
  id: string;
  agent: string;
  source: string;
  task: string | null;
  review: { author_name: string; rating: number | null; text: string | null } | null;
  subject: { message?: string | null; legacy_route?: string | null; legacy_ms?: number | null; router_ms?: number | null; compose_ms?: number | null; items?: number | null; entry?: { day: string; name: string; date_uncertain: boolean } | null; option?: number | null; question?: string | null; today?: string | null; ms?: number | null; queries?: { id: string; metric: string; available: boolean }[] | null; slot?: string | null; request?: string | null; photo_url?: string | null; sender?: string | null; event?: { field: string; from: string; to: string } | null; holiday?: { date: string; title: string } | null } | null;
  legacy_draft_id: string | null;
  legacy_text: string | null;
  outcome: "reply" | "question" | "unusable" | "none";
  output: {
    type?: string;
    // Reputation and Visibility: text and cta. Insights: headline, body and actions.
    content?: { text?: string; cta?: string | null; headline?: string; body?: string; subject?: string; actions?: { title: string; why: string; message: string }[] };
    sources_used?: string[];
    change?: { field: string; from: string; to: string } | null;
    photo_check?: { usable: boolean; reason_code: string; reason: string } | null;
    shoots?: { what: string; how: string; day: string; platform: string; caption: string; hashtags: string[] }[];
    // Insights: every figure it quoted, and how sure it is.
    figures?: { metric: string; value: number; unit: string; period: string; compare_to: string | null; compare_value: number | null; source: string }[];
    confidence?: string;
    // Growth: the campaign around the email, or a special idea.
    name?: string;
    segment?: string | null;
    audience_size?: number | null;
    send_at?: string | null;
    offer?: { type: string; description: string; conditions: string; valid_from: string; valid_to: string; applies_to: string | null } | null;
    idea?: { name: string; uses_dishes: string[]; ingredients: string[]; steps: string[]; why_now: string } | null;
    expected_outcome?: string;
    // The GM: its route (and reply, question or brief).
    route?: string;
    reply?: string | null;
    options?: { label: string; route: string }[];
    summary?: string;
    cards?: { draft_id: string; card: string }[];
    rolled?: string[];
  };
  question: string | null;
  checker: { verdict: string; checks: { id: string; result: string; reason: string | null }[]; minor_fixes: { find: string; replace: string }[] } | null;
  revisions: number;
  steps: { agent: string; version: string; verdict?: string; summary: string }[] | null;
  agent_version: string | null;
  checker_version: string | null;
  created_at: string;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const VERDICT_STYLE: Record<string, string> = { pass: "bg-emerald-100 text-emerald-900", fail: "bg-red-100 text-red-900", escalate: "bg-amber-100 text-amber-900" };
const NAMES: Record<CompareAgent, string> = { reputation: "Reputation", visibility: "Visibility", insights: "Insights", growth: "Growth", gm: "GM" };

// What the owner did with today's draft (the real one).
function ownerDid(d: Pick<Draft, "status" | "version"> | undefined) {
  if (!d) return "";
  const edited = d.version > 1 ? ", edited" : "";
  const status: Record<string, string> = { pending: "waiting", approved: "approved", queued: "approved, queued", sent: "approved and sent", skipped: "skipped", superseded: "replaced", withdrawn: "withdrawn", blocked: "blocked" };
  return `${status[d.status] ?? d.status}${edited}`;
}

// What the work was about.
function Subject({ r }: { r: ShadowRow }) {
  if (r.review) {
    return (
      <>
        <p className="font-semibold">
          {r.review.author_name} {"⭐".repeat(r.review.rating ?? 0)} {r.source === "pasted" && <span className="text-xs font-normal text-stone-500">(pasted by the owner)</span>}
        </p>
        <p className="mt-1 italic text-stone-700">&ldquo;{r.review.text ?? "(rating only)"}&rdquo;</p>
      </>
    );
  }
  const s = r.subject ?? {};
  const title: Record<string, string> = {
    google_post: `Google post (${s.slot === "owner_request" ? "the owner asked" : (s.slot ?? "weekly")})`,
    owner_photo: "A photo from the owner",
    staff_photo: "A photo from staff",
    profile_changed: `Profile change: ${s.event?.field ?? ""}`,
    content_brief: "Weekly content brief",
    bank_holiday: `Bank holiday ahead: ${s.holiday?.title ?? ""} (${s.holiday?.date ?? ""}), no special hours set`,
    owner_question: "The owner asked",
    owner_message: "The owner wrote",
    brief: `The morning brief (${s.items ?? 0} item${s.items === 1 ? "" : "s"} waiting)`,
    owner_request: "The owner asked for an offer",
    weekly_plan: `The Monday plan${s.option ? ` (option ${s.option})` : ""}`,
    calendar: `Calendar: ${s.entry?.name ?? ""} (${s.entry?.day ?? ""}${s.entry?.date_uncertain ? ", date uncertain" : ""})`,
    birthdays: "The weekly birthday email",
    special_ideas: `Special idea${s.option ? ` ${s.option}` : ""}`,
    monday_report: `The Monday report (made ${s.today ?? ""})`,
  };
  return (
    <>
      <p className="font-semibold">{title[r.source] ?? r.source}</p>
      {s.request && <p className="mt-1 italic text-stone-700">&ldquo;{s.request}&rdquo;</p>}
      {s.question && <p className="mt-1 italic text-stone-700">&ldquo;{s.question}&rdquo;</p>}
      {s.message && <p className="mt-1 italic text-stone-700">&ldquo;{s.message}&rdquo;</p>}
      {r.agent === "growth" && (s as { request?: string | null }).request && <p className="mt-1 italic text-stone-700">&ldquo;{(s as { request?: string }).request}&rdquo;</p>}
      {s.event && (
        <p className="mt-1 text-stone-700">
          {s.event.from} → <b>{s.event.to}</b>
        </p>
      )}
      {s.photo_url && (
        // eslint-disable-next-line @next/next/no-img-element -- a stored photo, for the builder only
        <img src={s.photo_url} alt="The photo" className="mt-2 h-28 w-auto rounded-lg border border-stone-200" />
      )}
    </>
  );
}

// Insights: the answer (or the report's headline, sales words and actions), and
// every figure it quoted with the query it came from.
function InsightsOutput({ r }: { r: ShadowRow }) {
  const c = r.output.content ?? {};
  const s = r.subject ?? {};
  return (
    <>
      {c.headline && <p className="font-semibold">{c.headline}</p>}
      {c.body && <p className="whitespace-pre-line">{c.body}</p>}
      {c.actions && c.actions.length > 0 && (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
          {c.actions.map((a, i) => (
            <li key={i}>
              <b>{a.title}</b>: {a.why} <span className="text-stone-500">(&ldquo;{a.message}&rdquo;)</span>
            </li>
          ))}
        </ol>
      )}
      {r.output.figures && r.output.figures.length > 0 && (
        <details className="mt-2 text-xs text-stone-600">
          <summary className="cursor-pointer">
            {r.output.figures.length} figure{r.output.figures.length === 1 ? "" : "s"}, confidence {r.output.confidence}
            {s.queries ? `, ${s.queries.length} quer${s.queries.length === 1 ? "y" : "ies"}` : ""}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {r.output.figures.map((f, i) => (
              <li key={i}>
                {f.metric}: {f.value} {f.unit} ({f.period}){f.compare_value !== null ? `, against ${f.compare_value} (${f.compare_to ?? ""})` : ""} · {f.source}
              </li>
            ))}
          </ul>
        </details>
      )}
      {typeof s.ms === "number" && <p className="mt-1 text-xs text-stone-500">Took {Math.round(s.ms / 1000)}s</p>}
    </>
  );
}

// Growth: the email (subject, words, offer, who and when, with a picture of it as
// customers see it), or a special idea, or nothing this week.
function GrowthOutput({ r }: { r: ShadowRow }) {
  const o = r.output;
  if (r.outcome === "none") return <p>Would propose nothing this week.</p>;
  if (o.idea) {
    return (
      <>
        <p className="font-semibold">{o.idea.name}</p>
        <p className="text-xs text-stone-600">Uses: {o.idea.uses_dishes.join(", ")} ({o.idea.ingredients.join(", ")})</p>
        <ol className="mt-1 list-decimal pl-5 text-xs">
          {o.idea.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <p className="mt-1 text-xs">Why now: {o.idea.why_now}</p>
      </>
    );
  }
  return (
    <>
      <p className="font-semibold">{o.content?.subject}</p>
      {o.content?.headline && <p className="font-medium">{o.content.headline}</p>}
      <p className="whitespace-pre-line">{o.content?.body}</p>
      {o.content?.cta && <p className="text-xs text-stone-600">Button: {o.content.cta}</p>}
      {o.offer && (
        <p className="mt-2 rounded-lg bg-white px-2 py-1 text-xs">
          🎁 <b>{o.offer.description}</b> ({o.offer.type.replace(/_/g, " ")}{o.offer.applies_to ? `, with ${o.offer.applies_to}` : ""}). {o.offer.conditions}. Valid {o.offer.valid_from} to {o.offer.valid_to}.
        </p>
      )}
      <p className="mt-1 text-xs text-stone-600">
        To {o.segment} ({o.audience_size}) · send {o.send_at?.replace("T", " ")}
        {o.expected_outcome ? ` · expected: ${o.expected_outcome}` : ""}
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a drawing of the email, for the builder only */}
      <img src={`/log/growth-preview/${r.id}`} alt="The email as customers see it" className="mt-2 w-48 rounded-lg border border-stone-200" />
    </>
  );
}

// The GM: where it would route the message (and what it would reply or ask), with
// how long it took; or its version of the morning brief.
function GmOutput({ r }: { r: ShadowRow }) {
  const o = r.output;
  const s = r.subject ?? {};
  if (r.source === "brief") {
    return (
      <>
        <p className="whitespace-pre-line">{o.summary}</p>
        {o.cards?.map((c, i) => (
          <p key={c.draft_id} className="mt-2 rounded-lg bg-white px-2 py-1 text-xs">
            <b>{i + 1}.</b> {c.card}
          </p>
        ))}
        {o.rolled && o.rolled.length > 0 && <p className="mt-1 text-xs text-stone-600">{o.rolled.length} more rolled to tomorrow (at most 5 cards).</p>}
        {typeof s.ms === "number" && <p className="mt-1 text-xs text-stone-500">Took {Math.round(s.ms / 1000)}s</p>}
      </>
    );
  }
  const same = s.legacy_route === o.route;
  return (
    <>
      <p>
        <b>Route: {ROUTE_WORDS[o.route as Route] ?? o.route}</b>
        {same ? " (same as today)" : <span className="text-amber-800"> (today: {ROUTE_WORDS[s.legacy_route as Route] ?? s.legacy_route})</span>}
      </p>
      {r.question && (
        <p className="mt-1">
          ❓ {r.question} {o.options?.map((x) => `[${x.label}]`).join(" ")}
        </p>
      )}
      {o.reply && <p className="mt-1 whitespace-pre-line">{o.reply}</p>}
      <p className="mt-1 text-xs text-stone-500">
        Routing {s.router_ms ? `${(s.router_ms / 1000).toFixed(1)}s` : "?"}
        {s.compose_ms ? ` + reply ${(s.compose_ms / 1000).toFixed(1)}s` : ""} · today&apos;s reply took {s.legacy_ms ? `${(s.legacy_ms / 1000).toFixed(1)}s` : "?"}
      </p>
    </>
  );
}

// What the agent would have produced.
function AgentOutput({ r }: { r: ShadowRow }) {
  if (r.outcome === "question") return <p className="whitespace-pre-line">❓ Would ask the owner: {r.question}</p>;
  const o = r.output;
  if (r.outcome === "unusable") {
    const code = (o.photo_check?.reason_code ?? "other") as Exclude<PhotoReason, "ok">;
    return (
      <>
        <p>🚫 Photo can&apos;t be used: {o.photo_check?.reason}</p>
        <p className="mt-1 text-xs text-stone-600">Staff would get the fixed tip: {PHOTO_TIPS[code] ?? PHOTO_TIPS.other}</p>
      </>
    );
  }
  if (r.agent === "insights") return <InsightsOutput r={r} />;
  if (r.agent === "growth") return <GrowthOutput r={r} />;
  if (r.agent === "gm") return <GmOutput r={r} />;
  return (
    <>
      {o.change && (
        <p className="mb-1 text-xs">
          <b>{o.change.field}</b>: {o.change.from} → <b>{o.change.to}</b>
        </p>
      )}
      <p className="whitespace-pre-line">{o.content?.text}</p>
      {o.content?.cta && <p className="mt-1 text-xs text-stone-600">Button: {o.content.cta}</p>}
      {o.shoots && o.shoots.length > 0 && (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
          {o.shoots.map((s, i) => (
            <li key={i}>
              <b>{s.day}, {s.platform}:</b> {s.what}. {s.how}. <i>{s.caption}</i> {s.hashtags.join(" ")}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export async function AgentCompare({ restaurantId, agent }: { restaurantId: string; agent: CompareAgent }) {
  const supabase = getSupabase();
  let rows: ShadowRow[] = [];
  try {
    rows =
      check(
        await supabase
          .from("shadow_drafts")
          .select("*")
          .eq("restaurant_id", restaurantId)
          .eq("agent", agent)
          .order("created_at", { ascending: false })
          .limit(50)
          .returns<ShadowRow[]>(),
      ) ?? [];
  } catch {
    // Before the shadow_drafts table exists there's nothing to compare.
  }
  const ids = rows.map((r) => r.legacy_draft_id).filter((id): id is string => Boolean(id));
  const legacy = ids.length
    ? (check(
        await supabase.from("drafts").select("id, status, version, content").eq("restaurant_id", restaurantId).in("id", ids).returns<Pick<Draft, "id" | "status" | "version" | "content">[]>(),
      ) ?? [])
    : [];
  const byId = new Map(legacy.map((d) => [d.id, d]));
  const counts = {
    total: rows.length,
    pass: rows.filter((r) => r.outcome === "reply" && r.checker?.verdict === "pass").length,
    question: rows.filter((r) => r.outcome === "question").length,
    unusable: rows.filter((r) => r.outcome === "unusable").length,
    revised: rows.filter((r) => r.revisions > 0).length,
  };
  const rate = agent === "reputation" ? await escalationRate(restaurantId) : null;
  const unit = agent === "reputation" ? "review" : agent === "insights" ? "question or report" : "piece of work";
  const none = rows.filter((r) => r.outcome === "none").length;

  return (
    <section className="space-y-3">
      <div className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-stone-200/70">
        <p className="font-semibold">{NAMES[agent]} in shadow mode</p>
        <p className="mt-1 text-stone-600">
          {counts.total} {unit === "review" ? `review${counts.total === 1 ? "" : "s"}` : unit === "question or report" ? `question${counts.total === 1 ? "" : "s"} and reports` : counts.total === 1 ? "piece of work" : "pieces of work"}: {counts.pass} {agent === "insights" ? "answers" : "drafts"} the checker passed, {counts.question} would ask the owner
          {agent === "visibility" ? `, ${counts.unusable} photos judged unusable` : ""}
          {agent === "growth" ? `, ${none} weekly plan${none === 1 ? "" : "s"} with nothing worth sending` : ""}, {counts.revised} needed a revision. The owner only ever saw the left-hand side.
        </p>
        {rate && (
          <p className={`mt-2 ${rate.high ? "font-semibold text-red-800" : "text-stone-700"}`}>
            Escalation rate, last 30 days: {rate.percent === null ? "no reviews yet" : `${rate.percent}% (${rate.questions} question${rate.questions === 1 ? "" : "s"} from ${rate.reviews} review${rate.reviews === 1 ? "" : "s"})`}
            {rate.high && ". Over 10%: worth a look."}
          </p>
        )}
      </div>
      {!rows.length && (
        <p className="text-sm text-stone-600">
          Nothing yet.{" "}
          {agent === "reputation"
            ? "Send NEW REVIEW (test tools) or wait for the hourly review check."
            : agent === "insights"
              ? "Ask a question about the numbers on WhatsApp (e.g. how was last week?), or send RUN REPORT (test tools)."
              : agent === "gm"
                ? "Send any message on WhatsApp (the GM logs where it would route it), or wait for the morning brief."
                : agent === "growth"
                ? "Ask for an offer on WhatsApp (e.g. Thursday is quiet), send BIRTHDAY CAMPAIGN, or wait for Monday."
                : "Send RUN POSTS (test tools) or a photo on WhatsApp, or wait for Monday."}
        </p>
      )}
      {rows.map((r) => {
        const today = r.legacy_draft_id ? byId.get(r.legacy_draft_id) : undefined;
        const failed = r.checker?.checks.filter((c) => c.result === "fail") ?? [];
        return (
          <article key={r.id} className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-stone-200/70">
            <header className="mb-3">
              <Subject r={r} />
              <p className="mt-1 text-xs text-stone-500">{when(r.created_at)}</p>
            </header>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-stone-50 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-stone-500">Today{today ? ` · ${ownerDid(today)}` : ""}</p>
                <p className="whitespace-pre-line">{r.legacy_text ?? "(nothing today: this is new work)"}</p>
                {today && today.content !== r.legacy_text && (
                  <p className="mt-2 whitespace-pre-line border-t border-stone-200 pt-2 text-stone-600">
                    <span className="text-xs font-semibold">After the owner&apos;s edit: </span>
                    {today.content}
                  </p>
                )}
              </div>
              <div className="rounded-xl bg-indigo-50 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-indigo-700">
                  {NAMES[agent]} {r.agent_version ? `v${r.agent_version}` : ""}
                  {r.revisions ? ` · ${r.revisions} revision${r.revisions === 1 ? "" : "s"}` : ""}
                </p>
                <AgentOutput r={r} />
              </div>
            </div>
            <footer className="mt-3 space-y-1">
              {r.checker && (
                <p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${VERDICT_STYLE[r.checker.verdict] ?? ""}`}>Checker {r.checker_version ? `v${r.checker_version}` : ""}: {r.checker.verdict}</span>
                  {r.checker.minor_fixes.length > 0 && <span className="ml-2 text-xs text-stone-600">{r.checker.minor_fixes.length} minor fix{r.checker.minor_fixes.length === 1 ? "" : "es"} applied</span>}
                </p>
              )}
              {failed.map((c) => (
                <p key={c.id} className="text-xs text-red-800">
                  {c.id}: {c.reason}
                </p>
              ))}
              {r.steps && r.steps.length > 1 && (
                <details className="text-xs text-stone-600">
                  <summary className="cursor-pointer">Every step ({r.steps.length})</summary>
                  <ol className="mt-1 list-decimal pl-5">
                    {r.steps.map((s, i) => (
                      <li key={i}>
                        {s.agent} v{s.version}
                        {s.verdict ? ` (${s.verdict})` : ""}: {s.summary}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {r.output.sources_used && r.output.sources_used.length > 0 && <p className="text-xs text-stone-500">Sources: {r.output.sources_used.join(", ")}</p>}
            </footer>
          </article>
        );
      })}
    </section>
  );
}

// Questions raised as a share of reviews in the last 30 days, shadow and live
// together: Reputation's own questions and the checker's escalations.
export async function escalationRate(restaurantId: string, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const supabase = getSupabase();
  const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const res = await q;
    return res.error ? 0 : (res.count ?? 0);
  };
  const head = { count: "exact" as const, head: true };
  const [shadowAll, shadowQ, liveQ, liveReplies] = await Promise.all([
    count(supabase.from("shadow_drafts").select("id", head).eq("restaurant_id", restaurantId).eq("agent", "reputation").gte("created_at", since)),
    count(supabase.from("shadow_drafts").select("id", head).eq("restaurant_id", restaurantId).eq("agent", "reputation").eq("outcome", "question").gte("created_at", since)),
    count(supabase.from("drafts").select("id", head).eq("restaurant_id", restaurantId).eq("kind", "review_question").gte("created_at", since)),
    count(supabase.from("drafts").select("id", head).eq("restaurant_id", restaurantId).eq("kind", "review_reply").not("agent_check", "is", null).eq("agent_check->>mode", "live").gte("created_at", since)),
  ]);
  return rateOf(shadowQ + liveQ, shadowAll + liveQ + liveReplies);
}

export function rateOf(questions: number, reviews: number) {
  const percent = reviews ? Math.round((questions / reviews) * 100) : null;
  return { questions, reviews, percent, high: percent !== null && percent > 10 };
}
