// Shown over the app when it's locked: Face ID / fingerprint starts by itself;
// "Use my password instead" logs out to the login screen.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, T, usePalette } from '@/components/ui';
import { Space } from '@/constants/theme';
import { useSession } from '@/lib/session';

export function LockScreen() {
  const c = usePalette();
  const { unlock, signOut } = useSession();
  useEffect(() => {
    unlock();
  }, [unlock]);
  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap, { backgroundColor: c.background }]} accessibilityViewIsModal>
      <T kind="title">DinerAI</T>
      <T quiet style={styles.center}>
        Locked to keep your restaurant safe.
      </T>
      <View style={styles.buttons}>
        <Button label="Unlock" onPress={unlock} />
        <Button label="Use my password instead" kind="plain" onPress={signOut} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: Space.l, gap: Space.m },
  center: { textAlign: 'center' },
  buttons: { width: '100%', maxWidth: 360, gap: Space.s, marginTop: Space.l },
});
