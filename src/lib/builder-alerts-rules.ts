// The restaurant id in an alert key like "billing:invoice.payment_failed:<uuid>",
// so the founder dashboard can show alerts on the client's page. Pure.
export function alertRestaurantId(key: string): string | null {
  return key.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0].toLowerCase() ?? null;
}
