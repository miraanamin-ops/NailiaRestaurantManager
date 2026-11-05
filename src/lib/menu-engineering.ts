// Menu engineering (4 Nov): which dishes make the most money, and which sell.
// The owner gives what each dish costs to make (an estimate is fine); code works
// out each dish's gross profit and puts it in one of four groups:
//   winner         high profit, popular: keep it front and centre
//   crowd_pleaser  popular, low profit: never discount it; look at its price or cost
//   hidden_gem     high profit, not popular: the one to push (posts, offers)
//   rethink        neither: change it or drop it
// Popularity comes from the till's sales by item when there are any, otherwise
// from the owner's own say ("top" and "slow" sellers). Without either, dishes are
// only split by profit. Prices on a UK menu include VAT, so profit is worked out on
// the price without it (20% unless set). Costs are never shown to customers
// (profile-data.ts customerSafeMenu).
// The offer rule: no offer may leave a dish under the owner's minimum profit
// (50% recommended) after the discount. Dishes without a cost aren't checked.
// No imports, so every rule is unit-tested (tests/menu-engineering.test.ts).

export const RECOMMENDED_MIN_MARGIN = 50;
export const UK_VAT = 0.2;

export type Group = "winner" | "crowd_pleaser" | "hidden_gem" | "rethink" | "high_profit" | "low_profit";
export const GROUP_WORDS: Record<Group, string> = {
  winner: "Winners",
  crowd_pleaser: "Crowd-pleasers",
  hidden_gem: "Hidden gems",
  rethink: "Rethink",
  high_profit: "Higher profit",
  low_profit: "Lower profit",
};

type Item = { name?: string; price?: number; cost?: number | null; cost_estimated?: boolean; seller?: "top" | "slow" | null };
type Menu = { category?: string; items?: Item[] }[] | null | undefined;

export type DishProfit = {
  name: string;
  category: string;
  price: number;
  cost: number;
  estimated: boolean;
  profit: number; // £ per dish, without VAT
  margin: number; // % of the price without VAT
  sold: number | null; // from the till, in the period
  popular: boolean | null; // null: not known
  group: Group;
};

export type MenuProfit = {
  dishes: DishProfit[];
  uncosted: string[];
  total: number;
  popularity: "sales" | "owner" | "none";
};

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const round2 = (n: number) => Math.round(n * 100) / 100;
const net = (price: number, vat: number) => price / (1 + vat);

// sales: quantity sold per item name, as the till names them (from sales_items).
export function menuProfit(menu: Menu, opts: { sales?: Record<string, number> | null; vat?: number } = {}): MenuProfit {
  const vat = opts.vat ?? UK_VAT;
  const all = (menu ?? []).flatMap((c) => (c.items ?? []).filter((i) => i?.name && (i.price ?? 0) > 0).map((i) => ({ ...i, category: c.category ?? "" })));
  const costed = all.filter((i) => typeof i.cost === "number" && i.cost >= 0);
  const uncosted = all.filter((i) => !costed.includes(i)).map((i) => i.name!);

  // Units sold per dish, matching the till's names to the menu's.
  const salesByKey = new Map<string, number>();
  for (const [name, qty] of Object.entries(opts.sales ?? {})) salesByKey.set(norm(name), (salesByKey.get(norm(name)) ?? 0) + (qty > 0 ? qty : 0));
  const soldOf = (name: string) => salesByKey.get(norm(name)) ?? 0;
  const salesKnown = costed.some((i) => soldOf(i.name!) > 0);
  const ownerKnown = !salesKnown && costed.some((i) => i.seller === "top" || i.seller === "slow");

  const rows = costed.map((i) => {
    const n = net(i.price!, vat);
    const profit = n - (i.cost as number);
    return { i, profit, margin: n > 0 ? (profit / n) * 100 : 0, sold: salesKnown ? soldOf(i.name!) : null };
  });

  // Popular: at least 70% of an even share of the dishes sold (the usual rule).
  const totalSold = rows.reduce((s, r) => s + (r.sold ?? 0), 0);
  const popularOf = (r: (typeof rows)[number]): boolean | null => {
    if (salesKnown) return rows.length && totalSold ? (r.sold ?? 0) / totalSold >= 0.7 / rows.length : null;
    if (ownerKnown) return r.i.seller === "top" ? true : r.i.seller === "slow" ? false : null;
    return null;
  };
  // High profit: at or above the average profit per dish (weighted by sales when known).
  const avgProfit = salesKnown && totalSold
    ? rows.reduce((s, r) => s + r.profit * (r.sold ?? 0), 0) / totalSold
    : rows.reduce((s, r) => s + r.profit, 0) / (rows.length || 1);

  const dishes: DishProfit[] = rows.map((r) => {
    const popular = popularOf(r);
    const high = r.profit >= avgProfit - 1e-9;
    const group: Group = popular === null ? (high ? "high_profit" : "low_profit") : popular ? (high ? "winner" : "crowd_pleaser") : high ? "hidden_gem" : "rethink";
    return {
      name: r.i.name!,
      category: r.i.category,
      price: r.i.price!,
      cost: r.i.cost as number,
      estimated: r.i.cost_estimated !== false,
      profit: round2(r.profit),
      margin: Math.round(r.margin),
      sold: r.sold,
      popular,
      group,
    };
  });
  return { dishes, uncosted, total: all.length, popularity: salesKnown ? "sales" : ownerKnown ? "owner" : "none" };
}

// The dishes to push (for posts, the weekly photo ask, offers): hidden gems, then
// winners, then higher-profit dishes, most profitable first.
export function dishesToPush(p: MenuProfit) {
  const rank: Partial<Record<Group, number>> = { hidden_gem: 0, winner: 1, high_profit: 2 };
  return p.dishes
    .filter((d) => rank[d.group] !== undefined)
    .sort((a, b) => rank[a.group]! - rank[b.group]! || b.profit - a.profit)
    .map((d) => d.name);
}

// Lines for Growth's input (and the report): which dishes to push and which never to discount.
export function menuProfitLines(p: MenuProfit, minMargin: number) {
  if (!p.dishes.length) return null;
  const names = (g: Group) => p.dishes.filter((d) => d.group === g).sort((a, b) => b.profit - a.profit).map((d) => `${d.name} (${d.margin}% profit)`);
  const lines: string[] = [];
  const push = [...names("hidden_gem"), ...names("winner"), ...names("high_profit")];
  if (push.length) lines.push(`Dishes to push (high profit${p.popularity === "none" ? "" : ", hidden gems first"}): ${push.slice(0, 5).join(", ")}.`);
  const protect = [...names("crowd_pleaser"), ...names("low_profit")];
  if (protect.length) lines.push(`Low profit, so never discount: ${protect.slice(0, 5).join(", ")}.`);
  lines.push(`No offer may leave a dish under ${minMargin}% profit after the discount (code checks).`);
  return lines.join("\n");
}

// ---------- The offer rule ----------

type Offer = { type: string; items?: string[]; applies_to?: string | null; discount_percent?: number | null; discount_value_gbp?: number | null; description: string };

const findItem = (menu: Menu, name: string | null | undefined): Item | null => {
  if (!name) return null;
  const want = norm(name);
  const list = (menu ?? []).flatMap((c) => c.items ?? []).filter((i) => i?.name);
  return list.find((i) => norm(i.name!) === want) ?? list.find((i) => norm(i.name!).includes(want) || (want.length > 3 && want.includes(norm(i.name!)))) ?? null;
};
const hasCost = (i: Item | null): i is Item & { cost: number; price: number } => Boolean(i && typeof i.cost === "number" && (i.price ?? 0) > 0);

// The offer's profit on each costed dish it touches, and the first one under the minimum.
export function offerMarginProblem(offer: Offer, menu: Menu, minMargin: number | null | undefined, vat = UK_VAT): string | null {
  const min = minMargin ?? RECOMMENDED_MIN_MARGIN;
  const marginOf = (revenue: number, cost: number) => (revenue > 0 ? ((revenue - cost) / revenue) * 100 : -Infinity);
  const under = (dish: string, margin: number) =>
    `"${offer.description}" leaves ${dish} at ${Math.max(Math.round(margin), -100)}% profit after the discount, under the ${min}% minimum`;
  const main = findItem(menu, offer.applies_to);
  const named = (offer.items ?? []).map((n) => findItem(menu, n));

  if (offer.type === "percent_off" && offer.discount_percent) {
    for (const i of [main, ...named]) {
      if (!hasCost(i)) continue;
      const m = marginOf(net(i.price, vat) * (1 - offer.discount_percent / 100), i.cost);
      if (m < min - 1e-9) return under(i.name!, m);
    }
  } else if (offer.type === "money_off" && offer.discount_value_gbp && hasCost(main)) {
    const m = marginOf(net(main.price - offer.discount_value_gbp, vat), main.cost);
    if (m < min - 1e-9) return under(main.name!, m);
  } else if (offer.type === "two_for_one") {
    for (const i of [main, ...named]) {
      if (!hasCost(i)) continue;
      const m = marginOf(net(i.price, vat), i.cost * 2);
      if (m < min - 1e-9) return under(`${i.name} (two for the price of one)`, m);
    }
  } else if (offer.type === "free_item" && hasCost(main)) {
    // The free item costs what it costs to make; without its cost, it isn't checked.
    const free = named.find((i) => i && i !== main) ?? null;
    if (hasCost(free)) {
      const m = marginOf(net(main.price, vat), main.cost + free.cost);
      if (m < min - 1e-9) return under(`${main.name} with a free ${free.name}`, m);
    }
  }
  return null;
}

// ---------- Costs the owner gives ----------

// "£4.20", "4.2", "about 4 quid" -> 4.2; a % ("30%") is a share of the price.
export function costFrom(text: string, price: number): number | null {
  const t = text.trim().toLowerCase();
  const pct = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) return price > 0 ? round2((price * Number(pct[1])) / 100) : null;
  const m = t.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return m ? round2(Number(m[1])) : null;
}

export type CostInput = { dish: string; cost: string; estimated?: boolean };

// The owner's costs onto the menu: by dish (their words), and a share of the price
// ("about 30% for everything else") for any dish still without one. Problems are
// dishes not on the menu and costs that make no sense (at or over the price).
export function applyCosts<M extends { category: string; items: (Item & { name: string; price: number })[] }>(
  menu: M[],
  input: { costs?: CostInput[]; rest_percent?: number | null; top?: string[]; slow?: string[] },
): { menu: M[]; problems: string[]; set: number } {
  const out = structuredClone(menu);
  const problems: string[] = [];
  let set = 0;
  const all = out.flatMap((c) => c.items);
  const find = (name: string) => all.find((i) => norm(i.name) === norm(name)) ?? all.find((i) => norm(i.name).includes(norm(name)) && norm(name).length > 3) ?? null;
  for (const c of input.costs ?? []) {
    const item = find(c.dish);
    if (!item) {
      problems.push(`"${c.dish}" isn't on the menu`);
      continue;
    }
    const cost = costFrom(c.cost, item.price);
    if (cost === null || cost <= 0) problems.push(`the cost of ${item.name} ("${c.cost}") isn't an amount`);
    else if (cost >= item.price) problems.push(`${item.name} costs £${cost.toFixed(2)} to make but sells for £${item.price.toFixed(2)}: is that right?`);
    else {
      item.cost = cost;
      item.cost_estimated = c.estimated !== false;
      set++;
    }
  }
  if (input.rest_percent != null) {
    if (!(input.rest_percent > 0 && input.rest_percent < 100)) problems.push("the share of the price for the other dishes should be between 1% and 99%");
    else
      for (const item of all)
        if (typeof item.cost !== "number" && item.price > 0) {
          item.cost = round2((item.price * input.rest_percent) / 100);
          item.cost_estimated = true;
          set++;
        }
  }
  for (const [list, seller] of [[input.top, "top"], [input.slow, "slow"]] as const)
    for (const name of list ?? []) {
      const item = find(name);
      if (item) item.seller = seller;
      else problems.push(`"${name}" isn't on the menu`);
    }
  return { menu: out, problems, set };
}

// ---------- The Monday report ----------

const list = (ds: DishProfit[], n = 3) => ds.slice(0, n).map((d) => `${d.name} (${d.margin}%)`).join(", ");

// The report's 3 or 4 key lines, from the groups (plain words, no AI).
export function menuReportLines(p: MenuProfit): string[] {
  if (!p.dishes.length) return [];
  const by = (g: Group) => p.dishes.filter((d) => d.group === g).sort((a, b) => b.profit - a.profit);
  const lines: string[] = [];
  if (p.popularity === "none") {
    const high = by("high_profit");
    const low = by("low_profit").sort((a, b) => a.margin - b.margin);
    if (high.length) lines.push(`Most profit per plate: ${list(high)}. These are the ones to push in posts and offers.`);
    if (low.length) lines.push(`Least profit per plate: ${list(low)}. Keep them out of offers.`);
    lines.push("Send your till's sales by item and I'll show which of these actually sell.");
  } else {
    const winners = by("winner");
    const gems = by("hidden_gem");
    const crowd = by("crowd_pleaser");
    const rethink = by("rethink");
    if (winners.length) lines.push(`⭐ Winners (sell well, high profit): ${list(winners)}. Keep them front and centre.`);
    if (gems.length) lines.push(`💎 Hidden gems (high profit, fewer sales): ${list(gems)}. Worth pushing: I'll favour them in posts and offers.`);
    if (crowd.length) lines.push(`🍽️ Crowd-pleasers (popular, lower profit): ${list(crowd)}. Never discount these; a small price rise or a cheaper ingredient would help.`);
    if (rethink.length) lines.push(`🔄 Rethink (low profit, few sales): ${list(rethink)}. Change them, or take them off.`);
  }
  if (p.uncosted.length) lines.push(`${p.uncosted.length} dish${p.uncosted.length === 1 ? " has" : "es have"} no cost yet: add them in settings to include them.`);
  return lines.slice(0, 5);
}

// Profit from the costed dishes sold (£, without VAT): quantity times profit per plate.
export function profitFromSales(p: MenuProfit, sales: Record<string, number>) {
  const sold = new Map<string, number>();
  for (const [name, qty] of Object.entries(sales)) sold.set(norm(name), (sold.get(norm(name)) ?? 0) + qty);
  return round2(p.dishes.reduce((s, d) => s + (sold.get(norm(d.name)) ?? 0) * d.profit, 0));
}
