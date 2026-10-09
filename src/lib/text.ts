// Small text helpers shared across the app. Plain code, no imports, so they
// can be used anywhere (including the unit tests).

// "1 review", "3 reviews", "2 replies".
export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// Hard limit on length (e.g. WhatsApp's 1600 characters), ending in "…" if cut.
export function clip(text: string, max: number) {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

// A short preview: one line, cut at a word boundary, ending in "…" if cut.
export function shorten(text: string, max: number) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
