import "server-only";
import { lastUndoable, logAction, markUndone, type AuditEntry } from "@/lib/audit";
import { check, draftName, getDraft, updateDraft, type Draft } from "@/lib/drafts";
import { google, type GooglePost } from "@/lib/google";
import { processQueue } from "@/lib/send";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { setStaffActive } from "./sales/staff";
import { showNumber } from "./onboarding/steps";
import { undoPlan } from "./undo-plan";

// UNDO: reverses the owner's last action (from the last 24 hours) where it can,
// and says plainly when it can't. APPROVE ALL is undone as one.

const SETTING_LABELS: Record<string, (v: unknown) => string> = {
  paused: (v) => (v ? "Sending is paused again" : "Sending is back on"),
  discount_cap_percent: (v) => `Discount cap is back to ${v}%`,
  fake_now: (v) => (v ? "The test clock is back on" : "The test clock is off again"),
  signup_reward: (v) => `Sign-up reward is back to "${v ?? "not set"}"`,
  owner_email: (v) => `Your email is back to ${v ?? "not set"}`,
  opening_hours: () => "Opening hours are back to how they were",
  menu: () => "The menu is back to how it was",
  brand_voice: () => "Your brand voice is back to how it was",
  phone: (v) => `Phone number is back to ${v ?? "not set"}`,
  address: (v) => `Address is back to ${v ?? "not set"}`,
  website: (v) => `Website is back to ${v ?? "not set"}`,
};

async function undoOne(entry: AuditEntry, restaurant: Restaurant, now: Date): Promise<{ text: string; done: boolean }> {
  const draft = entry.draft_id ? await getDraft(entry.draft_id).catch(() => null as Draft | null) : null;
  const plan = undoPlan(entry, draft, google().mode);
  const name = draft ? draftName(draft) : "";

  switch (plan.type) {
    case "cannot":
      return { text: `❌ Can't undo ${entry.detail?.toLowerCase() ?? "that"}: ${plan.reason}`, done: false };

    case "reopen":
      await updateDraft(draft!.id, { status: "pending", approved_at: null, scheduled_for: null, block_reason: null, waiting_for: null });
      return {
        text: `↩️ Cancelled: the ${name} won't be sent. It's back in your list (text NEXT to see it, or it'll be in the next brief).`,
        done: true,
      };

    case "withdraw_reply":
      await google().removeReply(restaurant.id, draft!.review_id!);
      await updateDraft(draft!.id, { status: "withdrawn" });
      return { text: `↩️ Took your ${name} down from (dummy) Google.`, done: true };

    case "withdraw_post": {
      const post = check(await getSupabase().from("google_posts").select("*").eq("draft_id", draft!.id).maybeSingle<GooglePost>());
      if (post) await google().unpublishPost(restaurant.id, post.id);
      await updateDraft(draft!.id, { status: "withdrawn" });
      return { text: "↩️ Took the Google post down from (dummy) Google.", done: true };
    }

    case "withdraw_simulated":
      await updateDraft(draft!.id, { status: "withdrawn" });
      return { text: `↩️ The ${name} was only simulated, so nothing reached anyone. Marked as withdrawn.`, done: true };

    case "restore_skip":
      await updateDraft(draft!.id, {
        status: "pending",
        waiting_for: null,
      });
      // The skip reason shouldn't keep teaching the assistant.
      check(await getSupabase().from("draft_feedback").delete().eq("draft_id", draft!.id).eq("kind", "skip").gte("created_at", entry.created_at));
      return { text: `↩️ Un-skipped the ${name}. It's back in your list.`, done: true };

    case "restore_edit": {
      const d = entry.data ?? {};
      await updateDraft(draft!.id, {
        content: String(d.before_content),
        version: Number(d.before_version ?? Math.max(1, draft!.version - 1)),
        checks: (d.before_checks as Draft["checks"]) ?? null,
        check_notes: (d.before_check_notes as Draft["check_notes"]) ?? null,
        waiting_for: "decision",
      });
      if (typeof d.feedback_id === "string") check(await getSupabase().from("draft_feedback").delete().eq("id", d.feedback_id));
      return { text: `↩️ Put back the previous version of the ${name}.`, done: true };
    }

    case "staff": {
      const ok = await setStaffActive(restaurant.id, plan.number, plan.active);
      if (!ok) return { text: `❌ Can't put ${showNumber(plan.number)} back: it's staff for another restaurant now.`, done: false };
      return { text: plan.active ? `↩️ ${showNumber(plan.number)} is back on your staff list.` : `↩️ Removed ${showNumber(plan.number)} from your staff list again.`, done: true };
    }

    case "restore_setting": {
      const fields: Partial<Restaurant> = { [plan.field]: plan.value };
      if (plan.field === "paused") fields.paused_at = plan.value ? new Date().toISOString() : null;
      check(await getSupabase().from("restaurants").update(fields).eq("id", restaurant.id));
      let extra = "";
      // Undoing a PAUSE means sending is back on: anything held goes out now.
      if (plan.field === "paused" && !plan.value) {
        const released = await processQueue({ ...restaurant, paused: false }, now);
        if (released.length) extra = ` ${released.length} held draft${released.length === 1 ? "" : "s"} went out.`;
      }
      return { text: `↩️ ${SETTING_LABELS[plan.field](plan.value)}.${extra}`, done: true };
    }
  }
}

export async function undoLast(restaurant: Restaurant, now: Date) {
  const entries = await lastUndoable(restaurant.id, now);
  if (!entries.length) {
    return "There's nothing to undo. UNDO reverses your last approval, skip, edit or setting change from the last 24 hours.";
  }
  const lines: string[] = [];
  for (const e of entries) {
    const { text, done } = await undoOne(e, restaurant, now);
    lines.push(text);
    await logAction({
      restaurantId: restaurant.id,
      draftId: e.draft_id,
      actor: "owner",
      action: "undone",
      detail: done ? `Undid: ${e.detail}` : `Tried to undo: ${e.detail} (not possible)`,
    });
  }
  // Mark them all as dealt with, so the next UNDO goes one step further back.
  await markUndone(entries.map((e) => e.id));
  return lines.join("\n");
}
