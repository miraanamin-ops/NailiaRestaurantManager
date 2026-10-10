// The owner's customer list as a CSV file (opens in Excel, Numbers or Google
// Sheets). Plain code with no imports (unit-tested in tests/customer-data.test.ts).

export type ExportCustomer = {
  name: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  source: string;
  created_at: string;
  email_confirmed_at: string | null;
  marketing_opt_in: boolean;
  unsubscribed_at: string | null;
  visit_count: number;
  last_visit: string | null;
  reward_redeemed_at: string | null;
};

export const CSV_HEADERS = [
  "Name",
  "Email",
  "Phone",
  "Birthday",
  "Signed up",
  "How they joined",
  "Email confirmed",
  "Gets marketing emails",
  "Unsubscribed",
  "Visits",
  "Last visit",
  "Welcome reward used",
];

// A cell that a spreadsheet could mistake for a formula (=, +, -, @) gets a leading
// apostrophe, so opening the file can never run anything.
export function csvCell(value: string | number | boolean | null | undefined) {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export function customersCsv(rows: ExportCustomer[]) {
  const lines = [CSV_HEADERS.map(csvCell).join(",")];
  for (const c of rows) {
    lines.push(
      [
        c.name,
        c.email,
        c.phone,
        c.birthday,
        day(c.created_at),
        c.source === "signup" ? "Sign-up form" : c.source,
        c.email_confirmed_at ? "Yes" : "No",
        c.marketing_opt_in && !c.unsubscribed_at && c.email_confirmed_at ? "Yes" : "No",
        day(c.unsubscribed_at),
        c.visit_count,
        c.last_visit ?? "",
        day(c.reward_redeemed_at),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // A byte-order mark so Excel reads names with accents correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

// What "delete my data" leaves behind: no name, email, phone, birthday or notes.
// The row itself stays (anonymous), so reports still count sign-ups, sends and redemptions.
export function anonymisedCustomer(now: Date) {
  return {
    name: "Deleted customer",
    email: null,
    phone: null,
    birthday: null,
    notes: null,
    marketing_opt_in: false,
    confirm_token: null,
    deleted_at: now.toISOString(),
  };
}
