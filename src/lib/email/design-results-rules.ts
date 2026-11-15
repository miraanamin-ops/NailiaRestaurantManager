// How the email designs do (phase 5 of the Inbox and emails plan, 15 Nov 2026): clicks,
// redemptions and opens per look, and with a dish photo against without. Plain code
// (tests/email-design-results.test.ts).
//
// Honest by rule: a difference is only told (to the owner) or acted on (a look taken
// out of turns) when there's enough data and it passes a two-proportion z-test at 95%.
// Clicks are the yardstick: opens are inflated by Apple Mail's privacy protection.

export type SendRow = {
  campaign_id: string;
  family: string; // email_design.family
  look: string; // email_design.look
  photo: boolean; // email_design.photo_url set
  opened: boolean;
  clicked: boolean;
  redeemed: boolean;
};

export type Arm = { sent: number; campaigns: number; opened: number; clicked: number; redeemed: number };

export const MIN = {
  // An owner line about photos: per arm, this many emails from this many campaigns.
  photoSends: 100,
  photoCampaigns: 3,
  // A look out of turns (all restaurants together): this many emails, this many campaigns.
  lookSends: 300,
  lookCampaigns: 5,
};
export const Z_95 = 1.96;
// A look leaves the turns when it gets under this share of its family's other looks' click rate.
export const WEAK_RATIO = 0.7;

export function arm(rows: SendRow[]): Arm {
  return {
    sent: rows.length,
    campaigns: new Set(rows.map((r) => r.campaign_id)).size,
    opened: rows.filter((r) => r.opened).length,
    clicked: rows.filter((r) => r.clicked).length,
    redeemed: rows.filter((r) => r.redeemed).length,
  };
}

const rate = (hits: number, n: number) => (n ? hits / n : 0);

// Two-proportion z (pooled). Positive: a's rate is higher.
export function zScore(hitsA: number, nA: number, hitsB: number, nB: number) {
  if (!nA || !nB) return 0;
  const p = (hitsA + hitsB) / (nA + nB);
  const se = Math.sqrt(p * (1 - p) * (1 / nA + 1 / nB));
  return se ? (rate(hitsA, nA) - rate(hitsB, nB)) / se : 0;
}

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

// The owner's line: emails with a dish photo against without, on clicks (else redemptions).
// Null until both have enough emails and campaigns and the difference is real.
export function photoInsight(rows: SendRow[]): string | null {
  const withPhoto = arm(rows.filter((r) => r.photo));
  const without = arm(rows.filter((r) => !r.photo));
  const enough = (a: Arm) => a.sent >= MIN.photoSends && a.campaigns >= MIN.photoCampaigns;
  if (!enough(withPhoto) || !enough(without)) return null;
  for (const [what, key] of [["clicks", "clicked"], ["redemptions", "redeemed"]] as const) {
    const z = zScore(withPhoto[key], withPhoto.sent, without[key], without.sent);
    if (Math.abs(z) < Z_95) continue;
    const a = rate(withPhoto[key], withPhoto.sent);
    const b = rate(without[key], without.sent);
    if (!a || !b) continue;
    const times = a > b ? a / b : b / a;
    const how = times >= 1.95 ? `${times.toFixed(1)}× the ${what}` : `${Math.round((times - 1) * 100)}% more ${what}`;
    return a > b ? `Emails with a dish photo got ${how} (${pct(a)} against ${pct(b)} without).` : `Emails without a photo got ${how} (${pct(b)} against ${pct(a)} with one).`;
  }
  return null;
}

// Per look, for the builder: emails, campaigns, open, click and redemption rates.
export type LookResult = { family: string; look: string } & Arm & { clickRate: number; redeemRate: number; openRate: number };
export function lookResults(rows: SendRow[]): LookResult[] {
  const keys = [...new Set(rows.map((r) => `${r.family}|${r.look}`))].sort();
  return keys.map((k) => {
    const [family, look] = k.split("|");
    const a = arm(rows.filter((r) => r.family === family && r.look === look));
    return { family, look, ...a, clickRate: rate(a.clicked, a.sent), redeemRate: rate(a.redeemed, a.sent), openRate: rate(a.opened, a.sent) };
  });
}

// Looks that clearly do worse than the rest of their family (all restaurants together):
// enough data, under WEAK_RATIO of the others' click rate, and significant. At most one
// per family, and never the family's only look: they're skipped in the turns.
export function weakLooks(rows: SendRow[], families: Record<string, readonly string[]>): string[] {
  const out: string[] = [];
  for (const [family, looks] of Object.entries(families)) {
    if (looks.length < 2) continue;
    let worst: { look: string; z: number } | null = null;
    for (const look of looks) {
      const mine = arm(rows.filter((r) => r.family === family && r.look === look));
      const rest = arm(rows.filter((r) => r.family === family && r.look !== look));
      if (mine.sent < MIN.lookSends || mine.campaigns < MIN.lookCampaigns || rest.sent < MIN.lookSends) continue;
      const ratio = rate(mine.clicked, mine.sent) / (rate(rest.clicked, rest.sent) || 1);
      const z = zScore(mine.clicked, mine.sent, rest.clicked, rest.sent);
      if (ratio < WEAK_RATIO && z <= -Z_95 && (!worst || z < worst.z)) worst = { look, z };
    }
    if (worst) out.push(worst.look);
  }
  return out;
}
