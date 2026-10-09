// Compliance check (plain code). At draft time it looks for claims that UK
// advertising rules treat as misleading unless they can be backed up. At send
// time, for emails, it confirms every recipient has valid consent and an
// unsubscribe link. No imports, so it's unit-tested.

type Rule = { pattern: RegExp; flag: string };

const CLAIM_RULES: Rule[] = [
  {
    pattern: /\b(?:the\s+)?(?:best|cheapest|finest|number\s+one|no\.?\s?1|#1)\b(?:\s+\w+){0,3}\s+in\s+(?:london|east\s+london|the\s+uk|britain|england|town|the\s+area|whitechapel|the\s+city)\b/i,
    flag: "says it's the best/cheapest in an area: a claim you'd need to be able to prove",
  },
  { pattern: /(?:^|\s)#1\b|\bnumber\s+one\b/i, flag: 'claims to be "number one": a claim you\'d need to be able to prove' },
  { pattern: /\bguarantee[ds]?\b|\brisk[-\s]free\b|\b100%\s+satisf/i, flag: "promises a guarantee the restaurant may not be able to keep" },
  {
    pattern: /\b(?:healthy|guilt[-\s]free|good\s+for\s+you|detox|cures?|boosts?\s+(?:your\s+)?immun\w*)\b/i,
    flag: "makes a health claim, which advertising rules restrict",
  },
  {
    pattern: /\b(?:last\s+chance|ends\s+tonight|today\s+only|only\s+today|hurry|while\s+stocks\s+last|selling\s+out\s+fast)\b/i,
    flag: "uses urgency (e.g. \"last chance\"): only OK if it's true",
  },
];

// Flags for anything that reads as a misleading claim. Empty = nothing found.
export function misleadingClaims(text: string, offer?: { validFrom: string; validUntil: string }) {
  const flags = CLAIM_RULES.filter((r) => r.pattern.test(text)).map((r) => r.flag);
  // "Today only" on an offer that actually runs for several days is false urgency.
  if (offer && offer.validFrom !== offer.validUntil && /\b(?:today\s+only|only\s+today|one\s+day\s+only|tonight\s+only)\b/i.test(text)) {
    flags.push(`says "today only" but the offer runs ${offer.validFrom} to ${offer.validUntil}`);
  }
  return [...new Set(flags)];
}

export type EmailComplianceInput = {
  eligible: number; // customers in the segment with valid consent right now
  excluded: number; // in the segment but no consent / unsubscribed
  missingUnsubscribe: number; // real emails that would go out without an unsubscribe link
};

// Send time, email campaigns: blocking problems, if any.
export function emailComplianceProblems(input: EmailComplianceInput) {
  const problems: string[] = [];
  if (input.eligible === 0) {
    problems.push(
      `No customers in this segment have valid email consent${input.excluded ? ` (${input.excluded} left out: no consent or unsubscribed)` : ""}.`,
    );
  }
  if (input.missingUnsubscribe > 0) {
    problems.push(`${input.missingUnsubscribe} email(s) would go out without an unsubscribe link.`);
  }
  return problems;
}
