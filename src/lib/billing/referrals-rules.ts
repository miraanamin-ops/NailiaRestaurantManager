// Owner referrals (step 47), as plain code (tests/referrals.test.ts). Each
// restaurant has a code like EMBER-7K2Q to share (or the link /start?ref=CODE).
// A new restaurant that signs up with it records referred_by; once the new one
// pays its first real invoice (after the free month), the recommending
// restaurant gets one month free: a £99 credit on its Stripe balance, which
// Stripe takes off its next invoices. Once per referred restaurant.

export const REFERRAL_CREDIT_PENCE = 9900;

// No 0/O or 1/I, so a code read out loud or copied by hand still works.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// The restaurant's first word (letters only, up to 8) and 4 characters from its id.
export function referralCodeFor(name: string, id: string, attempt = 0) {
  const word = (name.normalize("NFKD").toUpperCase().match(/[A-Z]+/g) ?? []).find((w) => !["THE", "LE", "LA", "AL", "EL"].includes(w)) ?? "DINER";
  let h = 2166136261 ^ attempt;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  let tail = "";
  for (let i = 0; i < 4; i++) {
    tail += ALPHABET[h % ALPHABET.length];
    h = Math.floor(h / ALPHABET.length) || Math.imul(h + i + 7, 2654435761) >>> 0;
  }
  return `${word.slice(0, 8)}-${tail}`;
}

// What someone typed, tidied; null if it can't be a referral code.
export function cleanReferralCode(typed: string | null | undefined) {
  const t = (typed ?? "").trim().toUpperCase().replace(/\s+/g, "").replace(/[–—_]/g, "-");
  return /^[A-Z]{2,8}-[A-Z0-9]{4}$/.test(t) ? t : null;
}

// Who may be recommended by whom: never yourself (the same restaurant or the same email).
export function canRefer(referrer: { id: string; owner_email: string | null }, newOwner: { id?: string; email: string }) {
  if (newOwner.id && newOwner.id === referrer.id) return false;
  return (referrer.owner_email ?? "").toLowerCase() !== newOwner.email.toLowerCase();
}

// A paid invoice that earns the recommending restaurant its free month: real
// money paid (the free month's £0 invoice doesn't count), for a restaurant that
// was recommended and hasn't earned its referrer a credit yet.
export function earnsReferralCredit(invoice: { amount_paid?: number | null; status?: string | null }, r: { referred_by?: string | null; referral_credited_at?: string | null }) {
  return Boolean(r.referred_by && !r.referral_credited_at && (invoice.amount_paid ?? 0) > 0 && (invoice.status ?? "paid") === "paid");
}

export function referralShareText(code: string, link: string) {
  return [
    `🤝 *Recommend DinerAI to another restaurant*`,
    `Your code: *${code}*`,
    `Or send them this link: ${link}`,
    ``,
    `When they've finished their free month and paid their first month, you get *one month free*. There's no limit.`,
  ].join("\n");
}

export function referralCreditedText(newRestaurant: string) {
  return `🎉 *${newRestaurant}* joined DinerAI on your recommendation and has paid their first month. Thank you! Your next month is free: £99 is off your next bill.`;
}
