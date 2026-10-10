// Where a customer email really goes, and who it's from. Plain code with no
// imports, so every rule is unit-tested (tests/email.test.ts).
//
//   - Dummy addresses (example.com and other reserved test domains, or seeded
//     dummy customers) are never emailed: they'd bounce and hurt the domain's
//     reputation. They're logged as "simulated".
//   - TEST_MODE=true: nothing reaches a stranger. Builder and owner addresses get
//     their own email; every other address is redirected to the builder.
//   - Otherwise the email goes to the customer.

export type EmailRoute =
  | { kind: "send"; to: string; redirectedFrom: string | null }
  | { kind: "simulate"; reason: string };

const RESERVED = /(^|\.)(example\.(com|org|net)|test|example|invalid|localhost)$/i;

export function isDummyAddress(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return !domain || RESERVED.test(domain);
}

export function routeEmail(
  to: string,
  opts: { testMode: boolean; allowed: string[]; builder: string | null; seed?: boolean },
): EmailRoute {
  const address = to.trim().toLowerCase();
  if (opts.seed || isDummyAddress(address)) return { kind: "simulate", reason: "dummy customer" };
  if (!opts.testMode) return { kind: "send", to: address, redirectedFrom: null };
  if (opts.allowed.map((a) => a.trim().toLowerCase()).includes(address)) return { kind: "send", to: address, redirectedFrom: null };
  if (opts.builder) return { kind: "send", to: opts.builder.trim().toLowerCase(), redirectedFrom: address };
  return { kind: "simulate", reason: "test mode, and no BUILDER_EMAIL to redirect to" };
}

// "Ember & Spice Grill <hello@mail.dinerai.co.uk>". The name is quoted, without
// characters that would break the header.
export function fromHeader(name: string, address: string) {
  const clean = name.replace(/["\\<>\r\n]/g, "").replace(/\s+/g, " ").trim().slice(0, 70) || "Your restaurant";
  return `"${clean}" <${address}>`;
}

export function senderAddress(env: Record<string, string | undefined>, localPart = "hello") {
  const domain = env.EMAIL_FROM_DOMAIN?.trim().replace(/^@/, "");
  if (domain) return `${localPart}@${domain}`;
  // Before a domain is verified, Resend only allows its test address.
  return env.EMAIL_FROM_ADDRESS?.trim() || "onboarding@resend.dev";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (s: string | null | undefined): s is string => Boolean(s && EMAIL_RE.test(s.trim()));
