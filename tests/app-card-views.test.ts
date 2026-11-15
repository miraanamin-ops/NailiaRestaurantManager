// Phase 2 of the Inbox and emails plan (15 Nov 2026): each Inbox card carries the
// thing itself (the rota, the email, the Google post, an hours or menu change) for the
// app to draw, and its one line comes from it.
import { describe, expect, test } from "vitest";
import { changeView } from "@/lib/app/card-views";
import { toCard, viewPreview } from "@/lib/app/cards";
import { appRotaWeek } from "@/lib/app/rota-rules";
import type { Draft } from "@/lib/drafts";

const draft = (fields: Partial<Draft> = {}): Draft =>
  ({ id: "d1", restaurant_id: "r1", kind: "hours_update", content: "", status: "pending", audience: null, created_at: "2026-11-10T09:00:00Z", checks: null, check_notes: null, ...fields }) as Draft;

describe("card views", () => {
  test("an hours update becomes before and after, day by day", () => {
    const content = "Your Friday hours change on Google.\n\nOn Google now: Fri: 12pm to 11pm; Sat: 12pm to 11pm\nAfter you approve: Fri: 12pm to 10pm; Sat: closed";
    expect(changeView("hours_update", content)).toEqual({
      type: "change",
      field: "hours",
      note: "Your Friday hours change on Google.",
      rows: [
        { label: "Fri", from: "12pm to 11pm", to: "12pm to 10pm" },
        { label: "Sat", from: "12pm to 11pm", to: "closed" },
      ],
    });
  });

  test("a menu update: added dishes have no 'before'", () => {
    const v = changeView("menu_update", "New dish.\n\nOn Google now: Lamb chops: not on the menu\nAfter you approve: Lamb chops: added, £14.00");
    expect(v?.field).toBe("menu");
    expect(v?.rows).toEqual([{ label: "Lamb chops", from: "not on the menu", to: "added, £14.00" }]);
  });

  test("words in another shape give no view (the card shows the words)", () => {
    expect(changeView("hours_update", "We're changing your hours.")).toBeNull();
  });

  test("the closed card's line comes from the view", () => {
    const week = appRotaWeek(
      { week_start: "2026-11-16", status: "draft", draft_id: "d1", share_token: null, summary: { days: [], totals: { hours: 120, costPence: 214000, labourPct: 27 }, flags: [] } as never },
      "2026-11-16",
      30,
    );
    expect(viewPreview({ type: "rota", week })).toMatch(/to Sun 22 Nov, £2,140$/);
    expect(viewPreview({ type: "email", subject: "10% off our mixed grill this week", html: "<p/>" })).toBe("10% off our mixed grill this week");
    const change = changeView("hours_update", "x\n\nOn Google now: Fri: 12pm to 11pm; Sat: 12pm to 11pm\nAfter you approve: Fri: 12pm to 10pm; Sat: closed");
    expect(viewPreview(change)).toBe("Fri: 12pm to 11pm → 12pm to 10pm, +1 more");
    const card = toCard(draft({ content: "x\n\nOn Google now: Fri: 12pm to 11pm\nAfter you approve: Fri: 12pm to 10pm" }), { review: null, body: "x", view: change });
    expect(card.view?.type).toBe("change");
    expect(toCard(draft({ kind: "review_reply" }), { review: null, body: "Thanks!" }).view).toBeNull();
  });
});
