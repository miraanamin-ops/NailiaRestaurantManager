// Shown over the app when it's locked: Face ID / fingerprint starts by itself;
// "Use my password instead" logs out to the login screen.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Icon, Logo, T, usePalette } from '@/components/ui';
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
      <Logo size={30} />
      <View style={[styles.lock, { backgroundColor: c.card, borderColor: c.border }]}>
        <Icon name="lock-closed" size={30} color={c.tint} />
      </View>
      <T kind="heading">Unlock DinerAI</T>
      <T quiet style={styles.center}>
        Locked to keep your restaurant’s details private.
      </T>
      <View style={styles.buttons}>
        <Button label="Unlock" icon="scan-outline" onPress={unlock} />
        <Button label="Use my password instead" kind="quiet" onPress={signOut} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: Space.l, gap: Space.m },
  center: { textAlign: 'center' },
  lock: { width: 76, height: 76, borderRadius: 38, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', marginTop: Space.l },
  buttons: { width: '100%', maxWidth: 360, gap: Space.s, marginTop: Space.l },
});
