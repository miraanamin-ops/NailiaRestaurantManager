// Create an account (phase 4): the website's sign-up, in the app. Your name, the
// restaurant's name, email, password (none after Sign in with Apple / Google: the
// email is theirs), mobile, the terms, and an optional recommendation or invite code.
// The server's rules are the website's (lib/signup/signup.ts). Next: "Start your free
// month", or straight into setup with Dina when there's an invite code.
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Button, Card, Screen, T, usePalette } from '@/components/ui';
import { Brand, Space, TapHeight } from '@/constants/theme';
import { API_URL, ApiError, dropPendingSocial, hasPendingSocial, signUp } from '@/lib/api';
import { useSession } from '@/lib/session';

// The server's answers (the website's /start?error= codes), in plain words.
const MESSAGES: Record<string, string> = {
  missing: 'Please fill in your name and the restaurant’s name.',
  email: 'That email doesn’t look right.',
  whatsapp: 'Please enter your mobile number, e.g. 07700 900123.',
  password_short: 'Your password needs at least 8 characters.',
  password_long: 'That password is too long.',
  terms: 'Please tick the box to accept the terms.',
  invite: 'That invite code isn’t valid or has been used up.',
  invite_only: 'DinerAI is invite-only for now. Enter your invite code below, or ask us for one at hello@dinerai.co.uk.',
  referral: 'That recommendation code isn’t one we know. Check it, or leave it empty.',
  slow: 'Too many sign-ups from here just now. Please try again later.',
  exists: 'There’s already a DinerAI account with that email. Log in instead (or reset your password).',
};

export default function SignUp() {
  const c = usePalette();
  const { startSession } = useSession();
  const params = useLocalSearchParams<{ email?: string; name?: string }>();
  // After Sign in with Apple / Google: the email is the one they vouched for.
  const [social] = useState(() => hasPendingSocial());
  const [ownerName, setOwnerName] = useState(params.name ?? '');
  const [restaurantName, setRestaurantName] = useState('');
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [mobile, setMobile] = useState('');
  const [terms, setTerms] = useState(false);
  const [referral, setReferral] = useState('');
  const [invite, setInvite] = useState('');
  const [showCodes, setShowCodes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!ownerName.trim() || !restaurantName.trim()) return setError(MESSAGES.missing);
    if (!social && password.length < 8) return setError(MESSAGES.password_short);
    if (!terms) return setError(MESSAGES.terms);
    setBusy(true);
    setError(null);
    try {
      const out = await signUp({
        ownerName: ownerName.trim(),
        restaurantName: restaurantName.trim(),
        email: email.trim().toLowerCase(),
        ...(social ? {} : { password }),
        whatsapp: mobile,
        terms,
        invite: invite.trim(),
        referral: referral.trim(),
      });
      await startSession(out.restaurantId);
    } catch (err) {
      setError(err instanceof ApiError ? (MESSAGES[err.code] ?? 'Something went wrong. Please try again.') : "Can't reach DinerAI. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  const page = (path: string) => () => WebBrowser.openBrowserAsync(`${API_URL}${path}`);
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <T kind="title">Create your account</T>
        <T quiet>About a minute. Then Dina helps you set up, and DinerAI starts working for your restaurant.</T>
        <Card>
          <Field label="Your name" value={ownerName} onChangeText={setOwnerName} autoComplete="name" textContentType="name" autoCapitalize="words" />
          <Field label="Restaurant name" value={restaurantName} onChangeText={setRestaurantName} autoCapitalize="words" textContentType="organizationName" />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            editable={!social}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            hint={social ? 'From your Apple or Google account.' : undefined}
          />
          {!social && (
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint="At least 8 characters." />
          )}
          <Field label="Your mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="07700 900123" />
          <Pressable
            onPress={() => setTerms(!terms)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: terms }}
            style={styles.tick}
            hitSlop={6}>
            <View style={[styles.box, { borderColor: terms ? Brand.signal : c.border, backgroundColor: terms ? Brand.signal : 'transparent' }]}>
              {terms && <T style={{ color: Brand.onSignal, fontWeight: '700' }}>✓</T>}
            </View>
            <T kind="small" style={{ flex: 1 }}>
              I accept the terms, the privacy notice and the data processing agreement.
            </T>
          </Pressable>
          <View style={styles.links}>
            <Link label="Terms" onPress={page('/terms')} />
            <Link label="Privacy" onPress={page('/privacy')} />
            <Link label="Data agreement" onPress={page('/dpa')} />
          </View>
        </Card>

        {showCodes ? (
          <Card>
            <Field label="Recommended by another restaurant? Their code (optional)" value={referral} onChangeText={setReferral} autoCapitalize="characters" placeholder="e.g. EMBER-7K2Q" />
            <Field label="Invite code (optional)" value={invite} onChangeText={setInvite} autoCapitalize="characters" />
          </Card>
        ) : (
          <Button label="I have a code" kind="plain" onPress={() => setShowCodes(true)} />
        )}

        {error && (
          <Card accent>
            <T style={{ color: c.danger }} accessibilityLiveRegion="polite">
              {error}
            </T>
          </Card>
        )}
        <Button label="Create my account" onPress={submit} busy={busy} />
        <Button
          label="I already have an account"
          kind="plain"
          onPress={() => {
            dropPendingSocial();
            router.back();
          }}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Field({ label, hint, ...rest }: TextInputProps & { label: string; hint?: string }) {
  const c = usePalette();
  return (
    <View style={{ gap: 4 }}>
      <T kind="small" quiet>
        {label}
      </T>
      <TextInput
        {...rest}
        accessibilityLabel={label}
        placeholderTextColor={c.textSecondary}
        style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: rest.editable === false ? c.background : c.card }]}
      />
      {hint ? (
        <T kind="small" quiet>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} accessibilityRole="link" hitSlop={8}>
      <T kind="small" style={{ color: c.tint, textDecorationLine: 'underline' }}>
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: TapHeight, borderWidth: 1, borderRadius: 12, paddingHorizontal: Space.m, fontSize: 17 },
  tick: { flexDirection: 'row', alignItems: 'center', gap: Space.s, minHeight: 44 },
  box: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  links: { flexDirection: 'row', gap: Space.m, flexWrap: 'wrap' },
});
