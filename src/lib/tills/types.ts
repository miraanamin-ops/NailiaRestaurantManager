// Till (EPOS) connections: the shapes every provider's data is turned into.
// No imports, so everything that uses only these is unit-tested.

export type TillProvider = "square" | "eposnow" | "lightspeed" | "toast";

// One sale line on an order, as we keep it: amount is the line total the
// customer paid, including VAT, after discounts (as the till prints it).
export type TillLine = { item: string; quantity: number; amount: number };

// One finished order (a receipt). closedAt is when it was paid/closed: that
// decides its London day and hour.
export type TillOrder = {
  id: string;
  closedAt: Date;
  lines: TillLine[];
  covers: number | null; // guests, where the till records them (Lightspeed, Toast)
};

export type TillConnection = {
  id: string;
  restaurant_id: string;
  provider: TillProvider;
  mode: "live" | "dummy";
  status: "ok" | "needs_reconnect" | "disconnected";
  external_account: string | null; // Square merchant, Lightspeed business, Epos Now device name, Toast restaurant guid
  external_location: string | null; // Square location, Lightspeed business location (blID)
  location_name: string | null;
  credentials_enc: string | null;
  synced_through: string | null; // everything closed before this has been read
  last_synced_at: string | null;
  last_error: string | null;
  connected_by: string | null;
  created_at: string;
};

// What a stored login holds (encrypted in credentials_enc).
export type TillCredentials =
  | { kind: "oauth"; access_token: string; refresh_token: string | null; expires_at: string | null }
  | { kind: "api_key"; key: string; secret: string };

// The till said the login no longer works: only the owner connecting again fixes it.
export class TillAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TillAuthError";
  }
}
