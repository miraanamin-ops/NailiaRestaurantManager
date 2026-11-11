// Paying in the app (phase 4, decision A): an App Store / Google Play subscription
// through RevenueCat. The app user id is the restaurant's id, so RevenueCat's webhook
// (/api/revenuecat/webhook on our server) tells us which restaurant paid; the server,
// not the phone, decides whether it runs (the same access rule as Stripe).
//
// Keys (public, safe in the app; from RevenueCat > Project settings > API keys):
//   EXPO_PUBLIC_REVENUECAT_IOS_KEY, EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
//   EXPO_PUBLIC_REVENUECAT_ENTITLEMENT  the entitlement that means "paid" (default "dinerai")
// Real purchases need a development or store build; in Expo Go RevenueCat runs in its
// preview mode (nothing is charged).
import { Platform } from 'react-native';
import Purchases, { type PurchasesPackage, type SubscriptionOption } from 'react-native-purchases';

const KEY = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
export const ENTITLEMENT = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT || 'dinerai';

let configuredFor: string | null = null;

export const purchasesReady = () => Boolean(KEY);

// RevenueCat, logged in as this restaurant.
export async function purchasesFor(restaurantId: string) {
  if (!KEY) throw new Error('Payments aren’t set up in this build yet');
  if (!configuredFor) {
    Purchases.configure({ apiKey: KEY, appUserID: restaurantId });
    configuredFor = restaurantId;
  } else if (configuredFor !== restaurantId) {
    await Purchases.logIn(restaurantId);
    configuredFor = restaurantId;
  }
  return Purchases;
}

export type Plan = { pkg: PurchasesPackage; price: string; founder: SubscriptionOption | null };

// The monthly plan from the current offering, with its store price (Apple and Google
// require the price to be shown before someone subscribes).
export async function monthlyPlan(restaurantId: string): Promise<Plan | null> {
  const p = await purchasesFor(restaurantId);
  const offering = (await p.getOfferings()).current;
  const pkg = offering?.monthly ?? offering?.availablePackages[0] ?? null;
  if (!pkg) return null;
  // Android: Google's founder offer (tagged "founder" in Play Console), used only after
  // our server accepted the FOUNDER code.
  const founder = pkg.product.subscriptionOptions?.find((o) => o.tags.includes('founder')) ?? null;
  return { pkg, price: pkg.product.priceString, founder };
}

// true: paid (the free month started). false: they closed the store's sheet.
export async function buy(restaurantId: string, plan: Plan, useFounder = false) {
  const p = await purchasesFor(restaurantId);
  try {
    const { customerInfo } = useFounder && plan.founder ? await p.purchaseSubscriptionOption(plan.founder) : await p.purchasePackage(plan.pkg);
    return Boolean(customerInfo.entitlements.active[ENTITLEMENT]);
  } catch (err) {
    if ((err as { userCancelled?: boolean }).userCancelled) return false;
    throw err;
  }
}

export async function restore(restaurantId: string) {
  const info = await (await purchasesFor(restaurantId)).restorePurchases();
  return Boolean(info.entitlements.active[ENTITLEMENT]);
}

// iPhone: Apple's own sheet for offer codes (FOUNDER). Afterwards the purchase arrives
// through the webhook like any other.
export async function redeemAppleCode(restaurantId: string) {
  await (await purchasesFor(restaurantId)).presentCodeRedemptionSheet();
}
