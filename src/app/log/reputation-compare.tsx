import { check, type Draft } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";

// The shadow comparison (builder only): for each review, today's reply, what
// Reputation would have written, and the checker's verdict, side by side.
// This is what decides when a restaurant switches Reputation to live.

type ShadowRow = {
  id: string;
  source: string;
  review: { author_name: string; rating: number | null; text: string | null };
  legacy_draft_id: string | null;
  legacy_text: string | null;
  outcome: "reply" | "question";
  output: { content?: { text?: string }; sources_used?: string[] };
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

// What the owner did with today's draft (the real one).
function ownerDid(d: Pick<Draft, "status" | "version"> | undefined) {
  if (!d) return "";
  const edited = d.version > 1 ? ", edited" : "";
  const status: Record<string, string> = { pending: "waiting", approved: "approved", queued: "approved, queued", sent: "approved and sent", skipped: "skipped", superseded: "replaced", withdrawn: "withdrawn", blocked: "blocked" };
  return `${status[d.status] ?? d.status}${edited}`;
}

export async function ReputationCompare({ restaurantId }: { restaurantId: string }) {
  const supabase = getSupabase();
  let rows: ShadowRow[] = [];
  try {
    rows =
      check(
        await supabase
          .from("shadow_drafts")
          .select("*")
          .eq("restaurant_id", restaurantId)
          .eq("agent", "reputation")
          .order("created_at", { ascending: false })
          .limit(50)
          .returns<ShadowRow[]>(),
      ) ?? [];
  } catch {
    // Before supabase/020_reputation.sql has been run there's nothing to compare.
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
    revised: rows.filter((r) => r.revisions > 0).length,
  };

  return (
    <section className="space-y-3">
      <div className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-stone-200/70">
        <p className="font-semibold">Reputation in shadow mode</p>
        <p className="mt-1 text-stone-600">
          {counts.total} review{counts.total === 1 ? "" : "s"}: {counts.pass} replies the checker passed, {counts.question} would ask the owner, {counts.revised} needed a revision.
          The owner only ever saw the left-hand reply.
        </p>
      </div>
      {!rows.length && <p className="text-sm text-stone-600">Nothing yet. Send NEW REVIEW (test mode) or wait for the hourly review check.</p>}
      {rows.map((r) => {
        const today = r.legacy_draft_id ? byId.get(r.legacy_draft_id) : undefined;
        const failed = r.checker?.checks.filter((c) => c.result === "fail") ?? [];
        return (
          <article key={r.id} className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-stone-200/70">
            <header className="mb-3">
              <p className="font-semibold">
                {r.review.author_name} {"⭐".repeat(r.review.rating ?? 0)} {r.source === "pasted" && <span className="text-xs font-normal text-stone-500">(pasted by the owner)</span>}
              </p>
              <p className="mt-1 italic text-stone-700">&ldquo;{r.review.text ?? "(rating only)"}&rdquo;</p>
              <p className="mt-1 text-xs text-stone-500">{when(r.created_at)}</p>
            </header>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-stone-50 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-stone-500">Today&apos;s reply{today ? ` · ${ownerDid(today)}` : ""}</p>
                <p className="whitespace-pre-line">{r.legacy_text ?? "(none)"}</p>
                {today && today.content !== r.legacy_text && (
                  <p className="mt-2 whitespace-pre-line border-t border-stone-200 pt-2 text-stone-600">
                    <span className="text-xs font-semibold">After the owner&apos;s edit: </span>
                    {today.content}
                  </p>
                )}
              </div>
              <div className="rounded-xl bg-indigo-50 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-indigo-700">
                  Reputation {r.agent_version ? `v${r.agent_version}` : ""}
                  {r.revisions ? ` · ${r.revisions} revision${r.revisions === 1 ? "" : "s"}` : ""}
                </p>
                {r.outcome === "question" ? (
                  <p className="whitespace-pre-line">❓ Would ask the owner: {r.question}</p>
                ) : (
                  <p className="whitespace-pre-line">{r.output.content?.text}</p>
                )}
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
              {r.output.sources_used && <p className="text-xs text-stone-500">Sources: {r.output.sources_used.join(", ")}</p>}
            </footer>
          </article>
        );
      })}
    </section>
  );
}
