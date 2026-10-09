// What Claude is sent: summaries on every message, specifics only when looked up.
import { describe, expect, test, vi } from "vitest";
import { customerSummary, lookUpCustomers, lookUpReviews, reviewSummary } from "@/lib/claude-data";

const now = new Date("2026-10-09T12:00:00Z");
const reviews = [
  { id: "a", author_name: "Aisha R.", rating: 5, text: "Best lamb chops", review_date: "2026-10-08T10:00:00Z", replied: false, reply_text: null },
  { id: "b", author_name: "Peter W.", rating: 1, text: "Lost our booking", review_date: "2026-09-01T10:00:00Z", replied: false, reply_text: null },
  { id: "c", author_name: "Imran S.", rating: 5, text: "Seekh kebabs were perfect", review_date: "2026-10-01T10:00:00Z", replied: true, reply_text: "Thanks!" },
];
const customers = [
  { id: "1", name: "Aisha Rahman", email: "aisha@example.com", birthday: "1990-10-11", visit_count: 14, last_visit: "2026-10-03", marketing_opt_in: true, notes: "Mixed grill" },
  { id: "2", name: "Tom Whitfield", email: "tom@example.com", birthday: "1985-06-08", visit_count: 1, last_visit: "2026-07-01", marketing_opt_in: false, notes: null },
];

describe("summaries sent with every message", () => {
  test("reviews: counts, averages and what needs a reply, but no review text", () => {
    const s = reviewSummary(reviews, now);
    expect(s).toMatchObject({ total: 3, average_rating: 3.7, not_replied: 2, not_replied_low_rated: 1 });
    expect(s.last_30_days.count).toBe(2);
    expect(JSON.stringify(s)).not.toMatch(/lamb chops|booking/);
  });
  test("customers: counts only, no names or contact details", () => {
    const s = customerSummary(customers, now);
    expect(s).toEqual({ total: 2, with_email_consent: 1, birthdays_next_7_days: 1, visited_last_30_days: 1 });
    expect(JSON.stringify(s)).not.toMatch(/Aisha|example\.com/);
  });
});

describe("look-ups for what a message needs", () => {
  test("reviews by stars, unreplied, or words; newest first; with ids for replies", () => {
    expect(lookUpReviews(reviews, { unreplied_only: true }).map((r) => r.id)).toEqual(["a", "b"]);
    expect(lookUpReviews(reviews, { max_rating: 3 }).map((r) => r.author)).toEqual(["Peter W."]);
    expect(lookUpReviews(reviews, { search: "kebab" }).map((r) => r.id)).toEqual(["c"]);
  });
  test("customers by name or birthday, never with email or phone", () => {
    const found = lookUpCustomers(customers, { name: "aisha" }, now);
    expect(found.map((c) => c.name)).toEqual(["Aisha Rahman"]);
    expect(JSON.stringify(found)).not.toMatch(/example\.com/);
    expect(lookUpCustomers(customers, { birthday_within_days: 7 }, now).map((c) => c.id)).toEqual(["1"]);
  });
  test("at most 10 at a time", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...reviews[0], id: `r${i}` }));
    expect(lookUpReviews(many, { limit: 50 })).toHaveLength(10);
  });
});

describe("chat looks up only what it needs (Claude replaced by a stand-in)", () => {
  test("the prompt has no customer list; a look-up's result is passed back, then the answer comes", async () => {
    const requests: { system: { text: string }[]; messages: { role: string; content: unknown }[] }[] = [];
    vi.doMock("@/lib/claude", () => ({
      MODEL: "test",
      MAX_TOKENS: 100,
      WITH_FALLBACK: {},
      claude: () => ({
        beta: {
          messages: {
            create: async (req: (typeof requests)[number]) => {
              requests.push(JSON.parse(JSON.stringify(req)));
              return requests.length === 1
                ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "look_up_reviews", input: { unreplied_only: true } }] }
                : { stop_reason: "end_turn", content: [{ type: "text", text: "Two reviews need replies: Aisha and Peter." }] };
            },
          },
        },
      }),
    }));
    vi.doMock("@/lib/campaigns", async (orig) => ({ ...(await orig<object>()), campaignContext: async () => "", recipientsFor: async () => ({ eligible: [], excluded: 0 }), recentCampaignStats: async () => [] }));
    vi.resetModules();
    const { chat } = await import("@/lib/assistant");
    const ctx = {
      restaurantName: "Ember & Spice Grill",
      restaurantId: "r1",
      restaurant: {},
      discountCapPercent: 20,
      now,
      today: "Friday, 9 October 2026",
      birthdaysThisWeek: [],
      data: { restaurant: { name: "Ember & Spice Grill" }, review_summary: reviewSummary(reviews, now), customer_summary: customerSummary(customers, now) },
      reviews,
      customers,
    } as never;
    const result = await chat(ctx, { feedback: [], approved: [] }, null, [{ direction: "inbound", body: "Which reviews need replies?", status: "received" }]);

    expect(result).toEqual({ type: "text", text: "Two reviews need replies: Aisha and Peter." });
    expect(requests).toHaveLength(2);
    const system = requests[0].system.map((b) => b.text).join("\n");
    expect(system).not.toMatch(/aisha@example\.com|Tom Whitfield|Lost our booking/);
    const toolResult = JSON.stringify(requests[1].messages.at(-1));
    expect(toolResult).toMatch(/Lost our booking/); // only after the look-up
    expect(toolResult).not.toMatch(/Seekh/); // the replied review wasn't asked for
    vi.doUnmock("@/lib/claude");
    vi.doUnmock("@/lib/campaigns");
  });
});
