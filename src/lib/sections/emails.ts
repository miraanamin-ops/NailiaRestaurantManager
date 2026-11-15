import "server-only";
import { photoLineFor } from "@/lib/email/design-results";
import type { ReportSectionDef } from "./types";

// The Monday report's "Your emails" (phase 5 of the Inbox and emails plan): what a dish
// photo does for this restaurant's offer emails. Only once it's real: enough emails with
// and without a photo, and a difference that passes the significance test.
export const emailsReportSection: ReportSectionDef = {
  id: "emails",
  order: 38,
  async build({ restaurant, period }) {
    const line = await photoLineFor(restaurant.id, period.end);
    if (!line) return null;
    return {
      title: "Your emails",
      stats: [],
      lines: [line, "Send a dish photo when we ask: it goes in the email and stays in your library for next time."],
      footnote: "From your offer emails in the last 6 months. A click is a tap on the email's button.",
    };
  },
  facts: (s) => `Emails: ${s.lines[0]}`,
};
