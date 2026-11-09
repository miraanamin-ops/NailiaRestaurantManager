import { unansweredForAdmin } from "@/lib/agents/unanswered";
import { Card } from "@/app/onboarding/ui";

// Owner messages DinerAI couldn't answer (unanswered_questions): counts by reason
// and the latest 20, so the builder can see what owners ask for that isn't there yet.
const REASON_WORDS: Record<string, string> = {
  off_topic: "Off topic",
  not_in_guide: "Not in the help guide (emailed support)",
  blocked: "Blocked by the fact check",
  could_not_help: "Nothing could answer it",
  router_failed: "Not understood in time",
};

export async function UnansweredSection() {
  const data = await unansweredForAdmin().catch((err: unknown) => ({ error: String(err) }));
  if ("error" in data) return <p className="mt-3 text-sm text-amber-800">Couldn&apos;t load unanswered questions ({data.error}). Has migration 063 been run?</p>;
  return (
    <>
      <h2 className="mt-8 text-xl font-semibold">Unanswered questions</h2>
      <Card>
        {data.counts.length ? (
          <ul className="text-sm">
            {data.counts.map((c) => (
              <li key={c.reason}>
                {REASON_WORDS[c.reason] ?? c.reason}: <b>{c.week}</b> in the last 7 days, {c.total} in all
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-500">None yet.</p>
        )}
      </Card>
      {data.latest.length > 0 && (
        <div className="mt-3 space-y-2">
          {data.latest.map((q) => (
            <Card key={q.id}>
              <p className="text-sm text-stone-500">
                {new Date(q.created_at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })} · {q.restaurant} · {REASON_WORDS[q.reason] ?? q.reason}
                {q.route ? ` · ${q.route}` : ""}
              </p>
              <p className="font-medium">&ldquo;{q.message}&rdquo;</p>
              {q.detail && <p className="text-xs text-stone-500">{q.detail.slice(0, 300)}</p>}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
