// The thing an Inbox card is about, drawn in the app (phase 2 of the Inbox and emails
// plan, 15 Nov 2026): the rota week, the real email, the Google post as Google shows
// it, an hours or menu change as before and after. Small on the open card (a tap opens
// it full screen), and full screen in the Inbox's viewer. Nothing opens a link.
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, TurboModuleRegistry, View, NativeModules } from 'react-native';

import { money } from '@/components/charts';
import { RotaWeek } from '@/components/rota-week';
import { Avatar, Icon, Panel, T, usePalette } from '@/components/ui';
import { Space } from '@/constants/theme';
import type { CardView, InboxCard } from '@/lib/api';

// The email is shown in a web view. A build of the app made before it was added has no
// web view, so the picture of the email is shown instead (importing the package there
// would crash, so it's only loaded once we know it's in the build).
type WebViewType = typeof import('react-native-webview').WebView;
function loadWebView(): WebViewType | null {
  try {
    const present = TurboModuleRegistry.get('RNCWebViewModule') ?? NativeModules.RNCWebViewModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return present ? (require('react-native-webview') as typeof import('react-native-webview')).WebView : null;
  } catch {
    return null;
  }
}
const WebView = loadWebView();

// Links in the email go nowhere in the preview (they'd leave the app).
const noLinks = `document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a');if(a){e.preventDefault();}},true);true;`;

export const hasFullView = (card: InboxCard) => Boolean(card.view);

// ---------- Small, on the open card ----------

export function CardViewSmall({ card, onOpen }: { card: InboxCard; onOpen: () => void }) {
  const c = usePalette();
  const view = card.view;
  if (!view) return null;
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel="Open full screen" style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}>
      <View style={[styles.small, { borderColor: c.border, backgroundColor: c.panel }]}>
        {view.type === 'rota' && <RotaMini view={view} />}
        {view.type === 'email' &&
          (card.previewImageUrl ? (
            <Image source={{ uri: card.previewImageUrl }} style={styles.emailThumb} contentFit="cover" contentPosition="top" accessibilityLabel="How the email will look" />
          ) : (
            <View style={styles.emailStub}>
              <Icon name="mail-outline" size={22} color={c.textSecondary} />
              <T style={{ fontWeight: '600', flex: 1 }} numberOfLines={2}>
                {view.subject ?? 'Your email'}
              </T>
            </View>
          ))}
        {view.type === 'google_post' && <GooglePost view={view} lines={4} />}
        {view.type === 'change' && <ChangeRows view={view} max={3} />}
        <View style={[styles.expand, { backgroundColor: c.card, borderColor: c.border }]}>
          <Icon name="expand-outline" size={14} color={c.text} />
          <T kind="caption">Full screen</T>
        </View>
      </View>
    </Pressable>
  );
}

function RotaMini({ view }: { view: Extract<CardView, { type: 'rota' }> }) {
  const c = usePalette();
  const t = view.week.totals;
  return (
    <View style={{ gap: 6, padding: Space.s + 2 }}>
      {view.week.days.map((d) => {
        const names = d.shifts.filter((s) => s.name).map((s) => s.name!.split(' ')[0]);
        const open = d.shifts.length - names.length;
        return (
          <View key={d.date} style={styles.miniRow}>
            <T kind="mono" style={{ width: 36 }}>
              {d.label.split(' ')[0]}
            </T>
            <T kind="small" numberOfLines={1} style={[{ flex: 1 }, d.closed && { color: c.textSecondary }]}>
              {d.closed ? 'Closed' : names.join(', ') || 'Nobody yet'}
              {open > 0 && <T kind="small" style={{ color: c.ember }}>{`${names.length ? ', ' : ''}${open} open`}</T>}
            </T>
            {!d.closed && d.costPence > 0 && (
              <T kind="mono" quiet>
                {money(d.costPence / 100)}
              </T>
            )}
          </View>
        );
      })}
      {t && (
        <View style={[styles.miniRow, styles.miniTotal, { borderTopColor: c.border }]}>
          <T kind="mono" style={{ flex: 1 }}>
            Week
          </T>
          <T kind="mono" style={{ color: t.overTarget ? c.ember : c.text }}>
            {money(t.costPence / 100)}
            {t.labourPct !== null ? ` · ${Math.round(t.labourPct)}%` : ''}
          </T>
        </View>
      )}
    </View>
  );
}

function GooglePost({ view, lines }: { view: Extract<CardView, { type: 'google_post' }>; lines?: number }) {
  return (
    <View style={{ gap: Space.s, padding: Space.s + 2 }}>
      <View style={styles.miniRow}>
        <Avatar name={view.name || 'G'} size={32} />
        <View style={{ flex: 1 }}>
          <T style={{ fontWeight: '600' }} numberOfLines={1}>
            {view.name}
          </T>
          <T kind="caption" quiet>
            On Google · after you approve
          </T>
        </View>
      </View>
      {view.photoUrl ? <Image source={{ uri: view.photoUrl }} style={styles.postPhoto} contentFit="cover" accessibilityLabel="The post's photo" /> : null}
      <T numberOfLines={lines}>{view.text}</T>
    </View>
  );
}

function ChangeRows({ view, max }: { view: Extract<CardView, { type: 'change' }>; max?: number }) {
  const c = usePalette();
  const rows = max ? view.rows.slice(0, max) : view.rows;
  return (
    <View style={{ gap: Space.s, padding: Space.s + 2 }}>
      <View style={styles.miniRow}>
        <T kind="caption" quiet style={{ flex: 1 }}>
          {view.field === 'menu' ? 'Dish' : 'Day'}
        </T>
        <T kind="caption" quiet style={styles.col}>
          On Google now
        </T>
        <T kind="caption" quiet style={styles.col}>
          After
        </T>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={styles.miniRow}>
          <T style={{ flex: 1, fontWeight: '600' }} numberOfLines={2}>
            {r.label}
          </T>
          <T kind="small" quiet style={[styles.col, { textDecorationLine: 'line-through' }]}>
            {r.from}
          </T>
          <T kind="small" style={[styles.col, { color: c.tint, fontWeight: '600' }]}>
            {r.to}
          </T>
        </View>
      ))}
      {max && view.rows.length > max ? (
        <T kind="caption" quiet>
          +{view.rows.length - max} more
        </T>
      ) : null}
    </View>
  );
}

// ---------- Full screen, in the Inbox's viewer ----------

export function CardViewFull({ card }: { card: InboxCard }) {
  const c = usePalette();
  const view = card.view;
  if (!view) return null;
  if (view.type === 'email') {
    if (WebView) {
      return (
        <WebView
          originWhitelist={['*']}
          source={{ html: view.html }}
          injectedJavaScript={noLinks}
          onShouldStartLoadWithRequest={(req) => req.url.startsWith('about:') || req.url.startsWith('data:')}
          setSupportMultipleWindows={false}
          style={{ flex: 1, backgroundColor: '#ffffff' }}
          accessibilityLabel="The email as your customers will see it"
        />
      );
    }
    return (
      <ScrollView contentContainerStyle={styles.fullPad}>
        {card.previewImageUrl ? <Image source={{ uri: card.previewImageUrl }} style={styles.emailFull} contentFit="contain" accessibilityLabel="How the email will look" /> : <T>{card.body}</T>}
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.fullPad}>
      {view.type === 'rota' && <RotaWeek week={view.week} next inInbox />}
      {view.type === 'google_post' && (
        <Panel style={{ padding: 0 }}>
          <GooglePost view={view} />
        </Panel>
      )}
      {view.type === 'change' && (
        <>
          {view.note ? <T quiet>{view.note}</T> : null}
          <Panel style={{ padding: 0, borderColor: c.border }}>
            <ChangeRows view={view} />
          </Panel>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  small: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    overflow: 'hidden',
  },
  expand: {
    alignSelf: 'flex-end',
    margin: 8,
    marginTop: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  miniTotal: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    marginTop: 2,
  },
  col: { width: '32%' },
  emailThumb: { width: '100%', height: 260 },
  emailStub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.s,
    padding: Space.m,
  },
  emailFull: { width: '100%', aspectRatio: 0.6 },
  postPhoto: { width: '100%', aspectRatio: 4 / 3, borderRadius: 10 },
  fullPad: { padding: Space.m, gap: Space.m, paddingBottom: Space.xl * 3 },
});
