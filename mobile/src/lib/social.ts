// Sign in with Apple and Sign in with Google (phase 4). The phone gets an ID token
// from Apple or Google; our server hands it to Supabase (/api/app/login/social), so
// it's the same login account as the website, matched by email. Someone new carries
// on to the sign-up form with that email.
//
// Apple: works in Expo Go on an iPhone. Apple is given a hashed one-time nonce and
// Supabase the original, so a stolen token can't be replayed.
// Google: needs a development or store build (it isn't in Expo Go) and
// EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (Google Cloud > Credentials > the Web client;
// also EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID for iPhone). Until then the button is hidden.
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { socialLogin, type SocialResult } from '@/lib/api';

export async function appleAvailable() {
  return Platform.OS === 'ios' && (await AppleAuthentication.isAvailableAsync().catch(() => false));
}

// null: the owner closed Apple's sheet.
export async function signInWithApple(): Promise<SocialResult | null> {
  const nonce = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
    throw err;
  }
  if (!credential.identityToken) throw new Error('Apple gave no login token');
  // Apple only sends the name the very first time.
  const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ') || null;
  return socialLogin('apple', credential.identityToken, { nonce, name });
}

const GOOGLE_WEB_CLIENT = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE_IOS_CLIENT = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

// The Google library is native code: loading it in Expo Go throws, so only on demand.
async function googleModule() {
  if (!GOOGLE_WEB_CLIENT || (Platform.OS === 'ios' && !GOOGLE_IOS_CLIENT)) return null;
  try {
    return await import('@react-native-google-signin/google-signin');
  } catch {
    return null;
  }
}

export async function googleAvailable() {
  return Boolean(await googleModule());
}

export async function signInWithGoogle(): Promise<SocialResult | null> {
  const g = await googleModule();
  if (!g) throw new Error('Google sign-in isn’t set up in this build');
  g.GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT, ...(GOOGLE_IOS_CLIENT ? { iosClientId: GOOGLE_IOS_CLIENT } : {}) });
  if (Platform.OS === 'android') await g.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await g.GoogleSignin.signIn();
  if (!g.isSuccessResponse(res)) return null;
  const token = res.data.idToken;
  if (!token) throw new Error('Google gave no login token');
  return socialLogin('google', token, { name: res.data.user.name ?? null });
}
