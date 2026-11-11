// Log in: email and password, the same account as the website. Sign-up in the
// app comes in phase 4; until then new owners sign up on the website.
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Screen, T, usePalette } from '@/components/ui';
import { Brand, Space, TapHeight } from '@/constants/theme';
import { API_URL, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

const MESSAGES: Record<string, string> = {
  wrong: "That email and password don't match a DinerAI account.",
  slow: 'Too many tries just now. Please wait a few minutes and try again.',
};

export default function SignIn() {
  const c = usePalette();
  const { signIn } = useSession();
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
        <T kind="small" quiet style={styles.center}>
          New to DinerAI? Sign up at dinerai.co.uk. Signing up in the app is coming soon.
        </T>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: Space.s, marginTop: Space.xl },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: Brand.signal },
  input: { minHeight: TapHeight, borderWidth: 1, borderRadius: 12, paddingHorizontal: Space.m, fontSize: 17 },
  center: { textAlign: 'center' },
});
