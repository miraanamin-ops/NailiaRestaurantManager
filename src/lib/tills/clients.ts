import "server-only";
import { londonParts } from "@/lib/clock";
import { appUrl } from "@/lib/supabase";
import { mapEposNowTransactions, mapLightspeedSales, mapSquareOrders, mapToastOrders, type EposNowTransaction, type LightspeedSale, type SquareOrder, type ToastOrder } from "./map";
import { eposNowBase, LIGHTSPEED_SCOPES, lightspeedBase, SQUARE_SCOPES, squareBase, toastBase } from "./providers";
import { TillAuthError, type TillCredentials, type TillOrder, type TillProvider } from "./types";

// The live calls to each till's API. Reading only: nothing here can change a
// till. Every call has a timeout; a refused login throws TillAuthError.

const env = () => process.env;
const SQUARE_VERSION = "2025-10-16";
const TIMEOUT = 20_000;

export const redirectUri = (provider: "square" | "lightspeed") => `${appUrl()}/api/till/${provider}/callback`;

async function call<T>(provider: TillProvider, url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  const body = await res.text();
  let json: unknown = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    json = null;
  }
  if (res.status === 401 || res.status === 403) throw new TillAuthError(`${provider} refused the login (${res.status})`);
  if (!res.ok) {
    const detail = typeof json === "object" && json ? JSON.stringify(json).slice(0, 200) : body.slice(0, 200);
    throw new Error(`${provider} answered ${res.status}: ${detail}`);
  }
  return json as T;
}

export type OAuthTokens = { access_token: string; refresh_token: string | null; expires_at: string | null; account: string | null };
const expiresIn = (seconds: unknown) => (typeof seconds === "number" ? new Date(Date.now() + (seconds - 60) * 1000).toISOString() : null);

// ---------- Square ----------

export function squareAuthUrl(state: string) {
  const p = new URLSearchParams({ client_id: env().SQUARE_APPLICATION_ID!, scope: SQUARE_SCOPES.join(" "), session: "false", state, redirect_uri: redirectUri("square") });
  return `${squareBase(env()).api}/oauth2/authorize?${p}`;
}

async function squareToken(params: Record<string, string>): Promise<OAuthTokens> {
  const res = await fetch(`${squareBase(env()).api}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
    body: JSON.stringify({ client_id: env().SQUARE_APPLICATION_ID, client_secret: env().SQUARE_APPLICATION_SECRET, ...params }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_at?: string; merchant_id?: string; message?: string; errors?: { code?: string; detail?: string }[] };
  if (!res.ok || !json.access_token) {
    const why = json.errors?.[0]?.detail ?? json.message ?? String(res.status);
    if (res.status === 400 || res.status === 401) throw new TillAuthError(`Square refused the login (${why})`);
    throw new Error(`Square token call failed (${why})`);
  }
  return { access_token: json.access_token, refresh_token: json.refresh_token ?? null, expires_at: json.expires_at ?? null, account: json.merchant_id ?? null };
}

export const squareExchange = (code: string) => squareToken({ code, grant_type: "authorization_code", redirect_uri: redirectUri("square") });
export const squareRefresh = (refreshToken: string) => squareToken({ refresh_token: refreshToken, grant_type: "refresh_token" });

const squareHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Square-Version": SQUARE_VERSION });

export async function squareLocations(token: string) {
  const json = await call<{ locations?: { id: string; name?: string; status?: string; country?: string }[] }>("square", `${squareBase(env()).api}/v2/locations`, { headers: squareHeaders(token) });
  return (json.locations ?? []).filter((l) => l.status !== "INACTIVE").map((l) => ({ id: l.id, name: l.name ?? l.id }));
}

export async function squareMerchantName(token: string) {
  const json = await call<{ merchant?: { business_name?: string } }>("square", `${squareBase(env()).api}/v2/merchants/me`, { headers: squareHeaders(token) });
  return json.merchant?.business_name ?? null;
}

export async function squareOrders(token: string, locationId: string, from: Date, to: Date): Promise<TillOrder[]> {
  const out: SquareOrder[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 200; page++) {
    const json = await call<{ orders?: SquareOrder[]; cursor?: string }>("square", `${squareBase(env()).api}/v2/orders/search`, {
      method: "POST",
      headers: squareHeaders(token),
      body: JSON.stringify({
        location_ids: [locationId],
        limit: 500,
        ...(cursor ? { cursor } : {}),
        query: {
          filter: { state_filter: { states: ["COMPLETED"] }, date_time_filter: { closed_at: { start_at: from.toISOString(), end_at: to.toISOString() } } },
          sort: { sort_field: "CLOSED_AT", sort_order: "ASC" },
        },
      }),
    });
    out.push(...(json.orders ?? []));
    if (!json.cursor) break;
    cursor = json.cursor;
  }
  return mapSquareOrders(out);
}

export async function squareRevoke(accessToken: string) {
  await fetch(`${squareBase(env()).api}/oauth2/revoke`, {
    method: "POST",
    headers: { Authorization: `Client ${env().SQUARE_APPLICATION_SECRET}`, "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
    body: JSON.stringify({ client_id: env().SQUARE_APPLICATION_ID, access_token: accessToken }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

// ---------- Lightspeed K-Series ----------

export function lightspeedAuthUrl(state: string) {
  const p = new URLSearchParams({ response_type: "code", client_id: env().LIGHTSPEED_CLIENT_ID!, redirect_uri: redirectUri("lightspeed"), scope: LIGHTSPEED_SCOPES.join(" "), state });
  return `${lightspeedBase(env()).authorize}?${p}`;
}

async function lightspeedToken(params: Record<string, string>): Promise<OAuthTokens> {
  const basic = Buffer.from(`${env().LIGHTSPEED_CLIENT_ID}:${env().LIGHTSPEED_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(lightspeedBase(env()).token, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    const why = `${json.error ?? res.status}${json.error_description ? `: ${json.error_description}` : ""}`;
    if (json.error === "invalid_grant" || json.error === "unauthorized_client") throw new TillAuthError(`Lightspeed refused the login (${why})`);
    throw new Error(`Lightspeed token call failed (${why})`);
  }
  return { access_token: json.access_token, refresh_token: json.refresh_token ?? null, expires_at: expiresIn(json.expires_in), account: null };
}

export const lightspeedExchange = (code: string) => lightspeedToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri("lightspeed") });
export const lightspeedRefresh = (refreshToken: string) => lightspeedToken({ grant_type: "refresh_token", refresh_token: refreshToken });

export async function lightspeedLocations(token: string) {
  type Biz = { businessName?: string; businessId?: number; businessLocations?: { blName?: string; blID?: number; country?: string }[] };
  const json = await call<{ _embedded?: { businessList?: Biz[] } }>("lightspeed", `${lightspeedBase(env()).api}/f/data/businesses?size=100`, { headers: { Authorization: `Bearer ${token}` } });
  return (json._embedded?.businessList ?? []).flatMap((b) =>
    (b.businessLocations ?? []).filter((l) => l.blID != null).map((l) => ({ id: String(l.blID), name: l.blName ?? b.businessName ?? String(l.blID), business: b.businessId != null ? String(b.businessId) : null })),
  );
}

export async function lightspeedOrders(token: string, locationId: string, from: Date, to: Date): Promise<TillOrder[]> {
  const out: LightspeedSale[] = [];
  let next: string | undefined;
  for (let page = 0; page < 500; page++) {
    const p = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), pageSize: "100" });
    if (next) p.set("nextPageToken", next);
    const json = await call<{ sales?: LightspeedSale[]; nextPageToken?: string }>("lightspeed", `${lightspeedBase(env()).api}/f/v2/business-location/${encodeURIComponent(locationId)}/sales?${p}`, { headers: { Authorization: `Bearer ${token}` } });
    out.push(...(json.sales ?? []));
    if (!json.nextPageToken || !(json.sales ?? []).length) break;
    next = json.nextPageToken;
  }
  return mapLightspeedSales(out);
}

// ---------- Epos Now ----------

const eposHeaders = (c: Extract<TillCredentials, { kind: "api_key" }>) => ({ Authorization: `Basic ${Buffer.from(`${c.key}:${c.secret}`).toString("base64")}`, "Content-Type": "application/json" });
const EPOS_PAGE = 200;

// "2026-11-05T00:00:00" in UK time, as Epos Now expects its dates.
function ukLocal(d: Date) {
  const p = londonParts(d);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}:${two(p.second)}`;
}

// Checks a pasted key and secret work (reads one page of products).
export async function eposNowCheck(c: Extract<TillCredentials, { kind: "api_key" }>) {
  await call<unknown[]>("eposnow", `${eposNowBase(env())}/api/v4/Product?page=1`, { headers: eposHeaders(c) });
}

async function eposNowProducts(c: Extract<TillCredentials, { kind: "api_key" }>) {
  const names = new Map<number, string>();
  for (let page = 1; page <= 100; page++) {
    const rows = await call<{ Id?: number; Name?: string }[]>("eposnow", `${eposNowBase(env())}/api/v4/Product?page=${page}`, { headers: eposHeaders(c) });
    for (const r of rows ?? []) if (r.Id != null && r.Name) names.set(r.Id, r.Name);
    if (!rows || rows.length < EPOS_PAGE) break;
  }
  return names;
}

export async function eposNowOrders(c: Extract<TillCredentials, { kind: "api_key" }>, from: Date, to: Date): Promise<TillOrder[]> {
  const products = await eposNowProducts(c);
  const out: EposNowTransaction[] = [];
  for (let page = 1; page <= 500; page++) {
    const p = new URLSearchParams({ startDate: ukLocal(from), endDate: ukLocal(to), page: String(page) });
    const rows = await call<EposNowTransaction[]>("eposnow", `${eposNowBase(env())}/api/v4/Transaction/GetByDate?${p}`, { headers: eposHeaders(c) });
    out.push(...(rows ?? []));
    if (!rows || rows.length < EPOS_PAGE) break;
  }
  return mapEposNowTransactions(out, products);
}

// ---------- Toast ----------
// One partner login for DinerAI (not per restaurant); each restaurant is picked
// with the Toast-Restaurant-External-ID header.

let toastToken: { token: string; until: number } | null = null;

async function toastAccess() {
  if (toastToken && toastToken.until > Date.now()) return toastToken.token;
  const json = await call<{ token?: { accessToken?: string; expiresIn?: number } }>("toast", `${toastBase(env())}/authentication/v1/authentication/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: env().TOAST_CLIENT_ID, clientSecret: env().TOAST_CLIENT_SECRET, userAccessType: "TOAST_MACHINE_CLIENT" }),
  });
  if (!json.token?.accessToken) throw new Error("Toast didn't send an access token");
  toastToken = { token: json.token.accessToken, until: Date.now() + Math.max(60, (json.token.expiresIn ?? 3600) - 300) * 1000 };
  return toastToken.token;
}

// The restaurants that have switched DinerAI on in Toast (for the builder to link).
export async function toastRestaurants() {
  const token = await toastAccess();
  const rows = await call<{ restaurantGuid?: string; restaurantName?: string; locationName?: string }[]>("toast", `${toastBase(env())}/partners/v1/restaurants`, { headers: { Authorization: `Bearer ${token}` } });
  return (rows ?? []).filter((r) => r.restaurantGuid).map((r) => ({ id: r.restaurantGuid!, name: [r.restaurantName, r.locationName].filter(Boolean).join(", ") || r.restaurantGuid! }));
}

export async function toastOrders(restaurantGuid: string, days: string[]): Promise<TillOrder[]> {
  const token = await toastAccess();
  const out: ToastOrder[] = [];
  for (const day of days) {
    for (let page = 1; page <= 100; page++) {
      const p = new URLSearchParams({ businessDate: day.replaceAll("-", ""), pageSize: "100", page: String(page) });
      const rows = await call<ToastOrder[]>("toast", `${toastBase(env())}/orders/v2/ordersBulk?${p}`, { headers: { Authorization: `Bearer ${token}`, "Toast-Restaurant-External-ID": restaurantGuid } });
      out.push(...(rows ?? []));
      if (!rows || rows.length < 100) break;
    }
  }
  return mapToastOrders(out);
}
