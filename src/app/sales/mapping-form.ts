import type { PosMapping } from "@/lib/sales/pos-table";

// The column choices on the check page, to and from form fields (the page's
// "Update preview" sends them in the address; "Import" posts them).

export const NONE = "__none__";

export function mappingFromForm(get: (key: string) => string): PosMapping | null {
  const opt = (k: string) => {
    const v = get(k);
    return v && v !== NONE ? v : null;
  };
  const date = opt("date");
  const item = opt("item");
  const price = opt("price");
  if (!date || !item || !price) return null;
  return {
    date,
    time: opt("time"),
    item,
    quantity: opt("quantity"),
    price,
    price_is: get("price_is") === "unit_price" ? "unit_price" : "line_total",
    receipt: opt("receipt"),
    date_order: get("date_order") === "mdy" ? "mdy" : get("date_order") === "ymd" ? "ymd" : "dmy",
  };
}
