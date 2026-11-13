// The founder's email address(es): FOUNDER_EMAIL (comma-separated for more than
// one), else miraan@dinerai.co.uk (the owner's choice, 13 Nov 2026). Only these can
// open /admin (lib/founder/access.ts). No imports, so the login and sign-up code can
// use it anywhere.
export const DEFAULT_FOUNDER_EMAIL = "miraan@dinerai.co.uk";
export function founderEmails(env: Record<string, string | undefined> = process.env) {
  return (env.FOUNDER_EMAIL?.trim() || DEFAULT_FOUNDER_EMAIL)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const isFounderEmail = (email: string | null | undefined, env: Record<string, string | undefined> = process.env) =>
  Boolean(email) && founderEmails(env).includes(email!.trim().toLowerCase());
