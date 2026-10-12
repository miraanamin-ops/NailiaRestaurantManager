// The Visibility agent, live: each saved case (agents/tests/visibility/) goes
// through the real loop (Visibility, the checker, up to 2 revisions) with real
// Claude, and the result must pass the case. Same commands as the others
// (npm run test:agents / test:agents:stability / test:agents:record).
import { describe, expect, test, vi } from "vitest";
import type { Resolved } from "@/lib/agents/tools";
import type { Usage } from "@/lib/agents/usage";
import type { VisibilityOutput } from "@/lib/agents/visibility-rules";
import { judgeVisibility, loadVisibilityCases, saveVisibilityRecorded, type VisibilityCase } from "../agents/support/visibility-cases";
import { hasKey, RECORD, reportRuns, RUNS } from "./support";

vi.mock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "test run: not sent" }));

function resolverFor(c: VisibilityCase) {
  const library = (c.profile.fields.photo_library ?? []) as { id: string }[];
  return async (refs: string[]): Promise<Resolved[]> =>
    refs.map((ref) => {
      const [kind, id] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
      if (kind === "profile" && id in c.profile.fields) return { ref, found: true, data: c.profile.fields[id] ?? null };
      if (kind === "photo") {
        const p = library.find((x) => x.id === id);
        return p ? { ref, found: true, data: p } : { ref, found: false, reason: "no such photo" };
      }
      if (kind === "request" && c.request) return { ref, found: true, data: { owner_asked: c.request } };
      if (kind === "post") {
        const posts = c.history.recent_posts.filter((p) => p.date.startsWith(id));
        return posts.length ? { ref, found: true, data: posts.map((p) => p.text) } : { ref, found: false, reason: "no Google post on that date" };
      }
      return { ref, found: false, reason: "not in this case's data" };
    });
}

async function photoFor(c: VisibilityCase) {
  if (!c.photo) return null;
  if (!c.photo.url) return { description: c.photo.description ?? null, note: c.photo.note, sender: c.photo.sender };
  const res = await fetch(c.photo.url);
  const data = Buffer.from(await res.arrayBuffer()).toString("base64");
  return { image: { media_type: "image/jpeg" as const, data }, note: c.photo.note, sender: c.photo.sender };
}

// A drawing of a Google post for the brand checks (the case's own photo, if it has one).
function previewFor(c: VisibilityCase, photo: Awaited<ReturnType<typeof photoFor>>) {
  return async (out: VisibilityOutput) => {
    if (out.type !== "google_post" && out.type !== "google_photo") return null;
    const { postPreviewPng } = await import("@/lib/google/post-preview");
    const image = photo && "image" in photo ? `data:${photo.image.media_type};base64,${photo.image.data}` : null;
    return postPreviewPng({ name: String(c.profile.fields.name), logoUrl: null, brandColor: "#c2410c", text: out.content.text, cta: out.content.cta, photo: image });
  };
}

describe.skipIf(!hasKey)("visibility (live)", () => {
  test.each(loadVisibilityCases())("$file", async ({ file, case: c }) => {
    const { visibilityLoop } = await import("@/lib/agents/visibility-core");
    const photo = await photoFor(c);
    const verdicts: string[] = [];
    const usages: Usage[] = [];
    const wrong: string[] = [];
    for (let run = 1; run <= RUNS; run++) {
      const outcome = await visibilityLoop(
        { task: c.task, profile: c.profile, history: c.history, slot: c.slot, request: c.request, photo, event: c.event, trends: c.trends, today: c.today },
        { resolve: resolverFor(c), checkerProfile: c.profile, recent: c.history.recent_posts.map((p) => p.text), preview: previewFor(c, photo) },
        `case ${file}`,
      );
      const by = outcome.kind === "question" ? (outcome.by === "maker" ? "visibility" : "checker") : null;
      verdicts.push(outcome.kind === "reply" ? `${outcome.output.type}/${outcome.checker.verdict}` : outcome.kind === "unusable" ? `unusable/${outcome.output.photo_check?.reason_code}` : `question by ${by}`);
      usages.push(outcome.usage);
      const result = {
        outcome: outcome.kind,
        by,
        question: outcome.kind === "question" ? `${outcome.question} (after ${outcome.revisions} revisions)` : null,
        output: outcome.output,
        checker: outcome.checker,
      };
      const problems = judgeVisibility(c, result);
      if (problems.length) wrong.push(`run ${run}: ${problems.join("; ")}`);
      if (RECORD && run === 1) {
        saveVisibilityRecorded(file, {
          outcome: outcome.kind,
          question_by: by,
          question: outcome.kind === "question" ? outcome.question : null,
          output: outcome.output,
          checker: outcome.checker ? { verdict: outcome.checker.verdict, checks: outcome.checker.checks, minor_fixes: outcome.checker.minor_fixes, owner_question: outcome.checker.owner_question } : null,
          revisions: outcome.revisions,
          agent_version: outcome.agentVersion,
          checker_version: outcome.checkerVersion,
          recorded_at: new Date().toISOString(),
        });
      }
    }
    reportRuns("visibility", file, verdicts, usages);
    expect(wrong).toEqual([]);
  });
});
