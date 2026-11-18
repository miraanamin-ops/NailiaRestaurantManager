// One welcome reward per person per restaurant (security review G1). A reward is tied
// to an email address, so signing up again with a second address used to give a second
// reward. The phone that redeems a welcome reward now remembers it (a cookie): the same
// phone can't redeem another person's welcome reward at that restaurant.
// It's a soft check (a different phone or a cleared browser gets past it); staff at the
// till still see every redemption. Pure, unit-tested in tests/reward-device.test.ts.

export const DEVICE_COOKIE = "dai_rw";
export const DEVICE_COOKIE_DAYS = 400; // browsers cap cookies at about 400 days
const MAX_ENTRIES = 20;

export type DeviceEntry = { restaurantId: string; customerId: string };

const ID = /^[0-9a-f-]{36}$/i;

export function parseDeviceCookie(raw: string | null | undefined): DeviceEntry[] {
  if (!raw) return [];
  return raw
    .split(".")
    .map((part) => part.split("~"))
    .filter(([r, c]) => r && c && ID.test(r) && ID.test(c))
    .map(([restaurantId, customerId]) => ({ restaurantId, customerId }));
}

// True when this phone already used a welcome reward at this restaurant for someone else.
export function usedHereByAnother(entries: DeviceEntry[], restaurantId: string, customerId: string) {
  return entries.some((e) => e.restaurantId === restaurantId && e.customerId !== customerId);
}

export function withEntry(entries: DeviceEntry[], entry: DeviceEntry): string {
  const rest = entries.filter((e) => !(e.restaurantId === entry.restaurantId && e.customerId === entry.customerId));
  return [...rest, entry]
    .slice(-MAX_ENTRIES)
    .map((e) => `${e.restaurantId}~${e.customerId}`)
    .join(".");
}

export function refusalMessage(restaurantName: string) {
  return `This phone has already used a welcome reward at ${restaurantName}. It's one per person, but you'll still get their offers by email.`;
}
