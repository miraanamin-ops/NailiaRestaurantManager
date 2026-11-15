// The thing an Inbox card is about, drawn in the app (phase 2 of the Inbox and emails
// plan, 15 Nov 2026): the rota week, the real email, the Google post as Google shows
// it, an hours or menu change as before and after. Small on the open card (a tap opens
// it full screen), and full screen in the Inbox's viewer. Nothing opens a link.
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, NativeModules, Pressable, ScrollView, StyleSheet, TurboModuleRegistry, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { money } from '@/components/charts';
import { RotaWeek } from '@/components/rota-week';
import { Avatar, Button, Icon, Panel, T, usePalette } from '@/components/ui';
import { Space } from '@/constants/theme';
import { getEmailLook, type CardView, type InboxCard } from '@/lib/api';

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
// This build can show an email inside the app (the email page); older builds can't.
export const hasWebView = Boolean(WebView);

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
          (WebView ? (
            // The real email, small and still (a tap opens it full screen).
            <View pointerEvents="none" style={styles.emailThumb}>
              <WebView originWhitelist={['*']} source={{ html: view.html }} scrollEnabled={false} style={{ flex: 1, backgroundColor: '#ffffff' }} />
            </View>
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

// "Try another look" applies to an email whose family has more than one design.
export const canChangeLook = (card: InboxCard) => card.view?.type === 'email' && (card.view.looks ?? 0) > 1;

// "See the email" on an email card with no view of its own (the chat): the real email
// full screen, in the app's web view, or the browser sheet on an older build.
export function SeeEmailButton({ card }: { card: InboxCard }) {
  const c = usePalette();
  const [open, setOpen] = useState(false);
  const url = card.previewHtmlUrl;
  if (!url) return null;
  return (
    <>
      <Button label="See the email" small icon="mail-open-outline" onPress={() => (WebView ? setOpen(true) : WebBrowser.openBrowserAsync(url))} />
      {WebView && (
        <Modal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setOpen(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={['top', 'bottom', 'left', 'right']}>
            <View style={[styles.sheetHead, { borderBottomColor: c.border }]}>
              <T kind="heading" numberOfLines={1} style={{ flex: 1 }}>
                {card.title}
              </T>
              <Pressable onPress={() => setOpen(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="close" size={22} color={c.text} />
              </Pressable>
            </View>
            <WebView originWhitelist={['*']} source={{ uri: url }} injectedJavaScript={noLinks} style={{ flex: 1, backgroundColor: '#ffffff' }} />
          </SafeAreaView>
        </Modal>
      )}
    </>
  );
}

// ---------- Full screen, in the Inbox's viewer ----------

// The email page (15 Nov, the owner's ask): the real email on the page, a swipe left or
// right for each of its family's looks, "Use this look" for the one on screen, and
// "Add photo" / "Change photo". Only with the web view (a new enough app build).
function EmailPager({ card, onUseLook, onPhoto, busy }: { card: InboxCard; onUseLook: (look: string) => void; onPhoto: (from: 'camera' | 'library') => void; busy: boolean }) {
  const c = usePalette();
  const { width } = useWindowDimensions();
  const view = card.view as Extract<CardView, { type: 'email' }>;
  const saved = view.lookKey ?? null;
  const options = view.options?.length ? [...view.options.filter((o) => o.key === saved), ...view.options.filter((o) => o.key !== saved)] : [{ key: saved ?? 'saved', name: view.look ?? 'This look' }];
  const [index, setIndex] = useState(0);
  const [html, setHtml] = useState<Record<string, string>>({ [saved ?? 'saved']: view.html });
  const current = options[index];
  useEffect(() => {
    if (!current || html[current.key]) return;
    let live = true;
    getEmailLook(card.id, current.key)
      .then((out) => {
        if (live) setHtml((h) => ({ ...h, [current.key]: out.html }));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [card.id, current, html]);
  const photo = () =>
    Alert.alert(view.photo ? 'Change photo' : 'Add a photo', 'It goes in the email (we check it first) and into your photo library.', [
      { text: 'Take photo', onPress: () => onPhoto('camera') },
      { text: 'Choose photo', onPress: () => onPhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  const W = WebView!;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))} style={{ flex: 1 }}>
        {options.map((o) => (
          <View key={o.key} style={{ width, flex: 1 }}>
            {html[o.key] ? (
              <W
                originWhitelist={['*']}
                source={{ html: html[o.key] }}
                injectedJavaScript={noLinks}
                onShouldStartLoadWithRequest={(req) => req.url.startsWith('about:') || req.url.startsWith('data:')}
                style={{ flex: 1, backgroundColor: '#ffffff' }}
              />
            ) : (
              <ActivityIndicator style={{ flex: 1 }} />
            )}
          </View>
        ))}
      </ScrollView>
      <View style={[styles.pagerBar, { borderTopColor: c.border }]}>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.dots}>
            {options.map((o, i) => (
              <View key={o.key} style={[styles.dot, { backgroundColor: i === index ? c.tint : c.border }]} />
            ))}
          </View>
          <T kind="small" quiet numberOfLines={1}>
            {current?.name}
            {current?.key === saved ? ' · chosen' : options.length > 1 ? ' · swipe for more' : ''}
          </T>
        </View>
        {current && current.key !== saved ? <Button label="Use this look" small icon="checkmark" onPress={() => onUseLook(current.key)} disabled={busy} /> : null}
        <Button label={view.photo ? 'Change photo' : 'Add photo'} kind="plain" small icon="camera-outline" onPress={photo} disabled={busy} />
      </View>
    </View>
  );
}

export function CardViewFull({ card, onUseLook, onPhoto, busy = false }: { card: InboxCard; onUseLook?: (look: string) => void; onPhoto?: (from: 'camera' | 'library') => void; busy?: boolean }) {
  const c = usePalette();
  const view = card.view;
  if (!view) return null;
  if (view.type === 'email') {
    if (WebView && onUseLook && onPhoto) return <EmailPager card={card} onUseLook={onUseLook} onPhoto={onPhoto} busy={busy} />;
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
        {/* An app build without the web view: the real email in the app's browser sheet. */}
        <T kind="heading">{view.subject ?? 'Your email'}</T>
        {card.previewHtmlUrl ? <Button label="See the email" icon="mail-open-outline" onPress={() => WebBrowser.openBrowserAsync(card.previewHtmlUrl!)} /> : <T>{card.body}</T>}
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
  postPhoto: { width: '100%', aspectRatio: 4 / 3, borderRadius: 10 },
  pagerBar: { flexDirection: 'row', alignItems: 'center', gap: Space.s, paddingHorizontal: Space.m, paddingVertical: Space.s, borderTopWidth: StyleSheet.hairlineWidth },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: Space.s, paddingHorizontal: Space.m, paddingVertical: Space.s + 2, borderBottomWidth: StyleSheet.hairlineWidth },
  fullPad: { padding: Space.m, gap: Space.m, paddingBottom: Space.xl * 3 },
});
