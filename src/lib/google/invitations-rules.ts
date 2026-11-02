// Accepting manager invitations automatically (lib/google/invitations.ts): which
// restaurant an invitation (or a profile our manager account can already see) is
// for. Plain code with no imports, unit-tested (tests/google-invitations.test.ts).
//
// A match needs a restaurant that's waiting for Google (the owner said "Done, I've
// invited you", and no location is linked yet) and either the same name, or a
// close name with the same postcode. Exactly one restaurant must match: anything
// else is left for the builder (alerted), never accepted on a guess.

export type Waiting = { id: string; name: string; address: string | null };
export type InvitationTarget = { locationName?: string | null; address?: string | null };

const NOISE = /\b(the|restaurant|ltd|limited|cafe|café|grill|kitchen|food|hall|uk|london)\b/g;

export function nameKey(name: string | null | undefined) {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const looseKey = (name: string | null | undefined) => nameKey(name).replace(NOISE, " ").replace(/\s+/g, " ").trim();

// "IG1 2AB" from an address, upper case and without the space; null if there's none.
export function postcodeOf(address: string | null | undefined) {
  const m = (address ?? "").toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/);
  return m ? `${m[1]}${m[2]}` : null;
}

export function matchesRestaurant(target: InvitationTarget, r: Waiting) {
  if (!target.locationName) return false;
  if (nameKey(target.locationName) === nameKey(r.name)) return true;
  const a = looseKey(target.locationName);
  const b = looseKey(r.name);
  const close = Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
  const pc = postcodeOf(target.address);
  return close && pc !== null && pc === postcodeOf(r.address);
}

export type Match = { restaurantId: string } | { restaurantId: null; reason: string };

export function matchInvitation(target: InvitationTarget, waiting: Waiting[]): Match {
  const hits = waiting.filter((r) => matchesRestaurant(target, r));
  if (hits.length === 1) return { restaurantId: hits[0].id };
  if (!hits.length) return { restaurantId: null, reason: "no restaurant waiting for Google matches it" };
  return { restaurantId: null, reason: `${hits.length} waiting restaurants match it (${hits.map((h) => h.name).join(", ")})` };
}
