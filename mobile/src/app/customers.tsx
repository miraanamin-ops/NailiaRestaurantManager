// More > Customers (phase 5): how many, who (searchable), the sign-up QR code and the
// printable pack, importing a list (through Chat, as on WhatsApp: you're asked how
// they agreed to hear from you first) and the export (the website's signed download
// page: only the download itself is logged).
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Screen, T, usePalette } from '@/components/ui';
import { Space, TapHeight } from '@/constants/theme';
import { exportCustomers, getCustomers, LoginNeeded, type Customers } from '@/lib/api';
import { useSession } from '@/lib/session';

const joined = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function CustomersScreen() {
  const c = usePalette();
  const { restaurantId, signOut } = useSession();
  const [data, setData] = useState<Customers | null>(null);
  const [list, setList] = useState<Customers['customers']>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(
    async (q: string, page = 0) => {
      try {
        const out = await getCustomers(restaurantId, q, page);
        setData(out);
        setList((now) => (page ? [...now, ...out.customers] : out.customers));
      } catch (err) {
        if (err instanceof LoginNeeded) return signOut();
        setNote("Can't reach DinerAI. Check your signal and try again.");
      }
    },
    [restaurantId, signOut],
  );
  // Searches as you type, a moment after you stop.
  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 350 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  async function exportList() {
    setBusy(true);
    try {
      await WebBrowser.openBrowserAsync((await exportCustomers(restaurantId)).url);
    } catch {
      setNote('Couldn’t get the download link. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      {!data ? (
        <ActivityIndicator />
      ) : (
        <>
          <Card>
            <T kind="metric">{data.total}</T>
            <T quiet>
              customers on your list · {data.subscribed} confirmed and getting your emails
            </T>
          </Card>

          <Card>
            <T kind="heading">Your sign-up QR code</T>
            <T kind="small" quiet>
              Customers scan it, join your list and get your sign-up reward.
            </T>
            <View style={styles.qrBox}>
              <Image source={{ uri: `data:image/svg+xml;utf8,${encodeURIComponent(data.qrSvg)}` }} style={styles.qr} contentFit="contain" accessibilityLabel="Your sign-up QR code" />
            </View>
            <Button label="Print the QR pack (PDF)" onPress={() => WebBrowser.openBrowserAsync(data.qrPackUrl)} />
            <Button label="Share the sign-up link" kind="plain" onPress={() => Share.share({ message: `Join our list for offers and a welcome reward: ${data.signupUrl}`, url: data.signupUrl })} />
          </Card>

          <Card>
            <T kind="heading">Import or export</T>
            <T kind="small" quiet>
              Import: send your list (CSV or Excel) in Chat. I’ll ask how they agreed to hear from you before anyone is emailed.
            </T>
            <Button label="Import a list in Chat" kind="plain" onPress={() => router.navigate({ pathname: '/chat', params: { attach: 'file' } })} />
            <Button label="Download my list (CSV)" kind="plain" onPress={exportList} busy={busy} />
          </Card>

          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name or email"
            placeholderTextColor={c.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search customers"
            style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
          />
          {search && (
            <T kind="small" quiet>
              {data.matching} found
            </T>
          )}
          {list.map((x) => (
            <View key={x.id} style={[styles.row, { borderColor: c.border }]}>
              <T style={{ fontWeight: '600' }}>{x.name || x.email || 'No name'}</T>
              {x.name && x.email ? (
                <T kind="small" quiet selectable>
                  {x.email}
                </T>
              ) : null}
              <T kind="small" quiet>
                {x.status} · joined {joined(x.joined)}
              </T>
            </View>
          ))}
          {list.length < data.matching && <Button label="Show more" kind="plain" onPress={() => load(search, data.page + 1)} />}
        </>
      )}
      {note && (
        <Card accent>
          <T>{note}</T>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  qrBox: { backgroundColor: '#ffffff', borderRadius: 16, padding: Space.m, alignItems: 'center' },
  qr: { width: 200, height: 200 },
  input: { minHeight: TapHeight, borderWidth: 1, borderRadius: 12, paddingHorizontal: Space.m, fontSize: 17 },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Space.s, gap: 2 },
});
