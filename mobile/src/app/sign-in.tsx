// Log in: email and password, or Sign in with Apple / Google (the same accounts as
// the website). New owners create an account here too (sign-up.tsx).
import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Screen, T, usePalette } from '@/components/ui';
import { Brand, Space, TapHeight } from '@/constants/theme';
import { API_URL, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { appleAvailable, googleAvailable, signInWithApple, signInWithGoogle } from '@/lib/social';

const MESSAGES: Record<string, string> = {
  wrong: "That email and password don't match a DinerAI account.",
  slow: 'Too many tries just now. Please wait a few minutes and try again.',
};

export default function SignIn() {
  const c = usePalette();
  const { signIn, startSession } = useSession();
  const [apple, setApple] = useState(false);
  const [google, setGoogle] = useState(false);
  useEffect(() => {
    appleAvailable().then(setApple);
    googleAvailable().then(setGoogle);
  }, []);

  // Apple or Google: an owner is in; someone new carries on to the sign-up form.
  async function social(provider: 'apple' | 'google') {
    setBusy(true);
    setError(null);
    try {
      const out = provider === 'apple' ? await signInWithApple() : await signInWithGoogle();
      if (!out) return;
      if (out.known) await startSession();
      else router.push({ pathname: '/sign-up', params: { email: out.email, name: out.name ?? '' } });
    } catch (err) {
      setError(err instanceof ApiError ? (MESSAGES[err.code] ?? 'That didn’t work. Please try again.') : "Can't reach DinerAI. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.trim() || !password) return setError('Please enter your email and password.');
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? (MESSAGES[err.code] ?? 'Something went wrong. Please try again.') : "Can't reach DinerAI. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  const input = [styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }];
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={styles.brand}>
          <View style={styles.dot} />
          <T kind="title">DinerAI</T>
        </View>
        <T quiet>Your restaurant’s AI manager. Log in with your DinerAI email and password.</T>
        <Card>
          <T kind="small" quiet>
            Email
          </T>
          <TextInput
            style={input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            returnKeyType="next"
            placeholder="you@restaurant.co.uk"
            placeholderTextColor={c.textSecondary}
            accessibilityLabel="Email"
          />
          <T kind="small" quiet>
            Password
          </T>
          <TextInput
            style={input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
            accessibilityLabel="Password"
          />
          {error && (
            <T kind="small" style={{ color: c.danger }} accessibilityLiveRegion="polite">
              {error}
            </T>
          )}
        </Card>
        <Button label="Log in" onPress={submit} busy={busy} />
        <Button label="Forgot your password?" kind="plain" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/login/forgot`)} />
        {apple && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={c.background === '#0b0c0a' ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={999}
            style={styles.apple}
            onPress={() => social('apple')}
          />
        )}
        {google && <Button label="Continue with Google" kind="plain" onPress={() => social('google')} disabled={busy} />}
        <View style={styles.or} />
        <T kind="small" quiet style={styles.center}>
          New to DinerAI?
        </T>
        <Button label="Create an account" kind="plain" onPress={() => router.push('/sign-up')} />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: Space.s, marginTop: Space.xl },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: Brand.signal },
  input: { minHeight: TapHeight, borderWidth: 1, borderRadius: 12, paddingHorizontal: Space.m, fontSize: 17 },
  center: { textAlign: 'center' },
  apple: { width: '100%', height: TapHeight },
  or: { height: Space.s },
});
