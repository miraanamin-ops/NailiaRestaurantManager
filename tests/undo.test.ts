// What UNDO does for each kind of action.
import { describe, expect, test } from "vitest";
import { undoPlan } from "@/lib/undo-plan";

const approved = { action: "approved", data: null };
const draft = (kind: string, status: string, review_id: string | null = null) => ({ kind, status, review_id });

describe("undoing an approval", () => {
  test("not sent yet (queued or blocked): cancelled and back in the list", () => {
    expect(undoPlan(approved, draft("email_campaign", "queued"), "dummy")).toEqual({ type: "reopen" });
    expect(undoPlan(approved, draft("promotion", "blocked"), "dummy")).toEqual({ type: "reopen" });
  });
  test("an email already sent can't be unsent, and says so", () => {
    const p = undoPlan(approved, draft("email_campaign", "sent"), "dummy");
    expect(p.type).toBe("cannot");
    expect(p.type === "cannot" && p.reason).toMatch(/can't be unsent/);
  });
  test("a review reply or Google post comes down again in dummy mode, not live", () => {
    expect(undoPlan(approved, draft("review_reply", "sent", "r1"), "dummy")).toEqual({ type: "withdraw_reply" });
    expect(undoPlan(approved, draft("google_post", "sent"), "dummy")).toEqual({ type: "withdraw_post" });
    expect(undoPlan(approved, draft("review_reply", "sent", "r1"), "live").type).toBe("cannot");
  });
  test("a simulated send is just marked withdrawn", () => {
    expect(undoPlan(approved, draft("promotion", "sent"), "dummy")).toEqual({ type: "withdraw_simulated" });
  });
  test("can't undo twice", () => {
    expect(undoPlan(approved, draft("review_reply", "withdrawn", "r1"), "dummy").type).toBe("cannot");
  });
});

describe("undoing a skip, an edit or a setting", () => {
  test("skip", () => {
    expect(undoPlan({ action: "skipped", data: null }, draft("review_reply", "skipped"), "dummy")).toEqual({ type: "restore_skip" });
    expect(undoPlan({ action: "skipped", data: null }, draft("review_reply", "pending"), "dummy").type).toBe("cannot");
  });
  test("edit: only while the draft is still waiting", () => {
    const edit = { action: "edited", data: { before_content: "old words" } };
    expect(undoPlan(edit, draft("promotion", "pending"), "dummy")).toEqual({ type: "restore_edit" });
    expect(undoPlan(edit, draft("promotion", "sent"), "dummy").type).toBe("cannot");
  });
  test("settings go back to their previous value", () => {
    expect(undoPlan({ action: "setting", data: { field: "discount_cap_percent", before: 20, after: 30 } }, null, "dummy")).toEqual({
      type: "restore_setting",
      field: "discount_cap_percent",
      value: 20,
    });
    expect(undoPlan({ action: "setting", data: { field: "paused", before: false, after: true } }, null, "dummy")).toEqual({
      type: "restore_setting",
      field: "paused",
      value: false,
    });
    expect(undoPlan({ action: "setting", data: { field: "something_else" } }, null, "dummy").type).toBe("cannot");
  });
});
