// The builder's email address(es): BUILDER_EMAIL, comma-separated for more than one.
// Used for builder login, alerts, and where TEST_MODE redirects customer emails.
export function builderEmails() {
  return (process.env.BUILDER_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
