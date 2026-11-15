// The Inbox: everything waiting for the owner, grouped the way they asked (12 Nov):
// four categories, each colour-coded, and inside each the message types.
//   Urgent        rotas, questions from DinerAI, "which did you mean?"   (ember)
//   Needs a look  1 to 3 star replies, emails, hours and menu updates...   (amber)
//   Not urgent    Google posts, special ideas: a tick on the card          (grey)
//   Simple        4 and 5 star replies, birthday emails: a tick, or all    (signal)
// The server decides each card's type and category (lib/app/cards.ts); a flagged one
// always needs a look. A closed card has round buttons on the right: a tick (simple and
// not urgent) or an eye that opens it (urgent and needs a look), and a pencil to edit;
// the arrow at the bottom opens it. Open: the full draft, Approve, Edit and Delete.
// Approve and Delete wait 5 seconds with Undo before they go to the server. Today's
// tiles open the Inbox at their type (?type=).
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Alert, KeyboardAvoidingView, Linking, LayoutAnimation, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { canChangeLook, CardViewFull, hasWebView } from '@/components/card-view';
import { DraftCardBody } from '@/components/draft-card';
import { Button, Card, Icon, IconTile, Pill, T, Skeleton, TabHeader, usePalette, useTabBarSpace, type IconName } from '@/components/ui';
import { MaxWidth, Space } from '@/constants/theme';
import { approveSimple, decide, getInbox, LoginNeeded, undoLast, uploadChatFile, type Category, type InboxCard } from '@/lib/api';
import { CATEGORIES, CATEGORY_ORDER, typeIcon } from '@/lib/kinds';
import { setBadge } from '@/lib/notifications';
import { useSession } from '@/lib/session';

const UNDO_SECONDS = 5;
const REASON_SECONDS = 8;
const SKIP_REASONS = ['Wrong tone', 'Wrong offer', 'Not now'];

type Action = 'approve' | 'skip';
type Pending = { card: InboxCard; action: Action; timer: ReturnType<typeof setTimeout> };
type Group = { category: Category; key: string; label: string; list: InboxCard[] };

// Older servers send no category: fall back to what they did send.
const categoryOf = (c: InboxCard): Category => c.category ?? (c.urgent ? 'urgent' : 'look');
const typeOf = (c: InboxCard) => c.type ?? { key: c.kind, label: c.kindLabel };

function groupsOf(cards: InboxCard[]): Group[] {
  const out: Group[] = [];
  for (const cat of CATEGORY_ORDER) {
    const byType = new Map<string, Group>();
    for (const card of cards) {
      if (categoryOf(card) !== cat) continue;
      const t = typeOf(card);
      const g = byType.get(t.key) ?? { category: cat, key: t.key, label: t.label, list: [] };
      g.list.push(card);
      byType.set(t.key, g);
    }
    out.push(...byType.values());
  }
  return out;
}

export default function Inbox() {
  const c = usePalette();
  const tabSpace = useTabBarSpace();
  const { me, restaurantId, signOut } = useSession();
  // note: set when a notification's Approve button brought the owner here.
  // type: a tile on Today, to open the Inbox at that type.
  const { note, type: jumpTo } = useLocalSearchParams<{ note?: string; type?: string }>();
  const [cards, setCards] = useState<InboxCard[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [editing, setEditing] = useState<InboxCard | null>(null);
  const [reasonFor, setReasonFor] = useState<InboxCard | null>(null);
  // The card shown full screen (its rota, email, post or change), with its buttons.
  const [full, setFull] = useState<InboxCard | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reasonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const groupY = useRef<Record<string, number>>({});

  const show = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const list = (await getInbox(restaurantId)).cards;
      setCards(list);
      setBadge(list.length);
    } catch (err) {
      if (err instanceof LoginNeeded) return signOut();
      setError("Can't reach DinerAI. Pull down to try again.");
    }
  }, [restaurantId, signOut]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // A tile on Today: scroll to that type once its group has been laid out.
  useEffect(() => {
    if (!jumpTo || !cards) return;
    const t = setTimeout(() => {
      // A type can sit in two categories (a flagged one needs a look): the first one.
      const ys = Object.entries(groupY.current).filter(([k]) => k.endsWith(`:${jumpTo}`)).map(([, y]) => y);
      const y = ys.length ? Math.min(...ys) : undefined;
      if (y !== undefined) scroller.current?.scrollTo({ y: Math.max(0, y - Space.s), animated: true });
      router.setParams({ type: undefined });
    }, 250);
    return () => clearTimeout(t);
  }, [jumpTo, cards]);

  // An approval or delete in its undo window. A second one, or leaving the screen,
  // sends the waiting one straight away rather than losing it.
  const pendingRef = useRef<Pending | null>(null);
  const flushRef = useRef<() => void>(() => {});
  const drop = (ids: string[]) => setCards((list) => (list ? list.filter((x) => !ids.includes(x.id)) : list));

  async function run(card: InboxCard, body: Parameters<typeof decide>[1], doneText: string, quiet = false) {
    try {
      const out = await decide(card.id, body);
      if (!quiet) show(out.replies[0] ?? doneText);
      return out;
    } catch (err) {
      if (err instanceof LoginNeeded) await signOut();
      else show("That didn't go through. Pull down and try again.");
      await load();
      return null;
    }
  }

  function sendPending() {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current = null;
    setPending(null);
    if (p.action === 'approve') run(p.card, { action: 'approve' }, 'Approved.').then((out) => {
        // An offer email may bring its photo request (phase 4): show it straight away.
        if (out && p.card.kind === 'email_campaign') load();
      });
    else
      run(p.card, { action: 'skip' }, 'Deleted.', true).then((out) => {
        if (!out) return;
        // "Why didn't it work?": optional, and it goes away on its own.
        setReasonFor(p.card);
        if (reasonTimer.current) clearTimeout(reasonTimer.current);
        reasonTimer.current = setTimeout(() => setReasonFor(null), REASON_SECONDS * 1000);
      });
  }
  useEffect(() => {
    flushRef.current = sendPending;
  });
  useEffect(() => () => flushRef.current(), []);

  function decideSoon(card: InboxCard, action: Action) {
    if (action === 'approve') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    sendPending();
    setReasonFor(null);
    LayoutAnimation.easeInEaseOut();
    drop([card.id]);
    setOpen(null);
    setFull(null);
    const p: Pending = { card, action, timer: setTimeout(sendPending, UNDO_SECONDS * 1000) };
    pendingRef.current = p;
    setPending(p);
  }

  function undoPending() {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current = null;
    LayoutAnimation.easeInEaseOut();
    setCards((list) => [p.card, ...(list ?? [])]);
    setPending(null);
    Haptics.selectionAsync().catch(() => {});
  }

  async function sendEdit(card: InboxCard, instructions: string) {
    setEditing(null);
    setBusy(true);
    const out = await run(card, { action: 'edit', instructions }, 'Rewritten: have a look.');
    setBusy(false);
    if (out?.card) setCards((list) => (list ? list.map((x) => (x.id === card.id ? out.card! : x)) : [out.card!]));
    else await load();
  }

  // A photo request (phase 4): take or pick a photo, it goes into the email (after a
  // check), and the email sends; or send it without one.
  async function addPhoto(card: InboxCard, from: 'camera' | 'library' | 'none') {
    if (busy) return;
    if (from === 'none') {
      setBusy(true);
      const out = await run(card, { action: 'nophoto' }, 'Sending without a photo.');
      setBusy(false);
      if (out) drop([card.id]);
      return;
    }
    if (from === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        show(perm.canAskAgain ? 'DinerAI needs the camera to take a photo.' : 'Camera access is off. Turn it on in Settings, then try again.');
        if (!perm.canAskAgain) Linking.openSettings().catch(() => {});
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, exif: false };
    const result = from === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const a = result.canceled ? null : result.assets[0];
    if (!a) return;
    setBusy(true);
    show('Checking your photo…');
    try {
      const mimeType = a.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
      const file = await uploadChatFile(restaurantId, { uri: a.uri, name: `photo.${mimeType === 'image/png' ? 'png' : 'jpg'}`, mimeType, size: a.fileSize ?? 1 });
      if ('refused' in file) return show(file.refused);
      const out = await run(card, { action: 'photo', path: file.path }, 'Photo added.');
      // A photo that won't do comes back with its reason, and the card stays. An email
      // keeps its card, now with the photo in it.
      if (out?.card) {
        const next = out.card;
        setCards((list) => (list ? list.map((x) => (x.id === next.id ? next : x)) : list));
        setFull((f) => (f && f.id === next.id ? next : f));
      } else if (out && card.kind === 'photo_request') drop([card.id]);
    } catch {
      show("That photo didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const bulk = (cards ?? []).filter((x) => x.bulk);
  function approveAll() {
    const n = bulk.length;
    Alert.alert(`Approve ${n} ${n === 1 ? 'item' : 'items'}?`, 'Good reviews and birthday emails, all checked.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: async () => {
          sendPending();
          // Gone at once; back again only if the server says no.
          const taken = bulk;
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          LayoutAnimation.easeInEaseOut();
          drop(taken.map((x) => x.id));
          show(`Approving ${n} ${n === 1 ? 'item' : 'items'}…`);
          try {
            const out = await approveSimple(restaurantId);
            show(out.notes[0] ?? `Approved ${out.approved} ${out.approved === 1 ? 'item' : 'items'}.`);
            if (out.approved < out.total) await load();
          } catch {
            show('That didn’t go through. Pull down and try again.');
            await load();
          }
        },
      },
    ]);
  }

  function undoLastDecision() {
    Alert.alert('Undo your last decision?', 'Sent emails can’t be taken back.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Undo',
        onPress: async () => {
          try {
            show((await undoLast(restaurantId)).message);
            await load();
          } catch {
            show('Couldn’t undo just now.');
          }
        },
      },
    ]);
  }

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const toggle = (id: string) => {
    LayoutAnimation.easeInEaseOut();
    setOpen((x) => (x === id ? null : id));
  };
  const groups = groupsOf(cards ?? []);
  const restaurant = me?.restaurants.find((r) => r.id === restaurantId)?.name ?? null;
  const floatBottom = Platform.OS === 'ios' ? tabSpace - Space.s : Space.m;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]} edges={['top', 'left', 'right']}>
      <TabHeader restaurant={restaurant} onRestaurant={(me?.restaurants.length ?? 0) > 1 ? () => router.navigate('/more') : undefined} />
      <ScrollView ref={scroller} contentContainerStyle={[styles.list, { paddingBottom: tabSpace + 72 }]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1, gap: 4 }}>
            <T kind="title">Inbox</T>
            {cards && cards.length > 0 && (
              <T kind="mono" quiet>
                {cards.length} waiting
              </T>
            )}
          </View>
          <Button label="Undo" kind="plain" small icon="arrow-undo" onPress={undoLastDecision} />
        </View>

        {note ? (
          <Card accent>
            <T>{note}</T>
            <Button label="OK" kind="plain" small onPress={() => router.setParams({ note: undefined })} />
          </Card>
        ) : null}
        {error && (
          <Card tone="amber">
            <T>{error}</T>
          </Card>
        )}
        {!cards && !error && <Skeleton lines={4} />}

        {cards && cards.length === 0 && (
          <Card>
            <View style={styles.empty}>
              <Icon name="checkmark-done-circle" size={44} color={c.tint} />
              <T kind="heading">All done for now</T>
            </View>
          </Card>
        )}

        {bulk.length > 1 && (
          <Card accent>
            <View style={styles.quickRow}>
              <T style={{ fontWeight: '600', flex: 1 }}>{bulk.length} quick ones, all checked</T>
              <Button label="Approve all" small icon="checkmark-done" onPress={approveAll} />
            </View>
          </Card>
        )}

        {groups.map((g, i) => {
          const firstOfCategory = i === 0 || groups[i - 1].category !== g.category;
          const cat = CATEGORIES[g.category];
          return (
            <View key={`${g.category}:${g.key}`} onLayout={(e) => (groupY.current[`${g.category}:${g.key}`] = e.nativeEvent.layout.y)} style={{ gap: Space.s + 2 }}>
              {firstOfCategory && <CategoryTitle category={g.category} />}
              <View style={styles.typeHead}>
                <Icon name={typeIcon(g.key)} size={16} color={toneColour(c, cat.tone)} />
                <T kind="label" quiet style={{ flex: 1 }}>
                  {g.label} · {g.list.length}
                </T>
              </View>
              {g.list.map((card) => (
                <Row
                  key={card.id}
                  card={card}
                  open={open === card.id}
                  busy={busy}
                  onToggle={() => toggle(card.id)}
                  onApprove={() => decideSoon(card, 'approve')}
                  onDelete={() => decideSoon(card, 'skip')}
                  onEdit={() => setEditing(card)}
                  onFull={() => setFull(card)}
                  onPhoto={(from) => addPhoto(card, from)}
                />
              ))}
            </View>
          );
        })}
      </ScrollView>

      {reasonFor && !pending ? (
        <View style={[styles.float, { bottom: floatBottom, backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.reasonHead}>
            <T kind="small" style={{ flex: 1 }}>
              Why not? (optional)
            </T>
            <Pressable onPress={() => setReasonFor(null)} hitSlop={12} accessibilityLabel="No reason">
              <Icon name="close" size={18} color={c.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.pills}>
            {SKIP_REASONS.map((r) => (
              <Pressable
                key={r}
                accessibilityRole="button"
                onPress={() => {
                  const card = reasonFor;
                  setReasonFor(null);
                  run(card, { action: 'reason', reason: r }, 'Thanks, noted.');
                }}
                style={[styles.chip, { backgroundColor: c.panel, borderColor: c.border }]}>
                <T kind="small">{r}</T>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (pending || toast) ? (
        <View style={[styles.float, styles.toastRow, { bottom: floatBottom, backgroundColor: c.card, borderColor: c.border }]} accessibilityLiveRegion="polite">
          <Icon name={pending ? (pending.action === 'approve' ? 'checkmark-circle' : 'trash-outline') : 'information-circle-outline'} color={pending?.action === 'skip' ? c.textSecondary : c.tint} />
          <T kind="small" style={{ flex: 1 }}>
            {pending ? (pending.action === 'approve' ? 'Approved.' : 'Deleted.') : toast}
          </T>
          {pending && (
            <Pressable onPress={undoPending} hitSlop={12} accessibilityRole="button" style={[styles.undo, { backgroundColor: c.panel }]}>
              <T kind="mono" style={{ color: c.tint }}>
                Undo
              </T>
            </Pressable>
          )}
        </View>
      ) : null}

      <FullView
        card={full}
        busy={busy}
        onUseLook={async (look) => {
          if (!full) return;
          setBusy(true);
          const out = await run(full, { action: 'look', look }, 'Look chosen.');
          setBusy(false);
          if (out?.card) {
            setFull(out.card);
            setCards((list) => (list ? list.map((x) => (x.id === out.card!.id ? out.card! : x)) : list));
          }
        }}
        onPhoto={(from) => {
          if (full) addPhoto(full, from);
        }}
        onLook={async () => {
          if (!full) return;
          setBusy(true);
          const out = await run(full, { action: 'look' }, 'Changed the look.');
          setBusy(false);
          if (out?.card) {
            setFull(out.card);
            setCards((list) => (list ? list.map((x) => (x.id === out.card!.id ? out.card! : x)) : list));
          }
        }}
        onClose={() => setFull(null)}
        onApprove={() => full && decideSoon(full, 'approve')}
        onDelete={() => full && decideSoon(full, 'skip')}
        onEdit={() => {
          const card = full;
          setFull(null);
          // The edit sheet opens once the viewer has gone (two sheets at once don't show on iOS).
          if (card) setTimeout(() => setEditing(card), 400);
        }}
      />
      <EditSheet key={editing?.id ?? 'none'} card={editing} onCancel={() => setEditing(null)} onSend={sendEdit} />
    </SafeAreaView>
  );
}

function toneColour(c: ReturnType<typeof usePalette>, tone: 'ember' | 'amber' | 'neutral' | 'signal') {
  return tone === 'ember' ? c.ember : tone === 'amber' ? c.amber : tone === 'signal' ? c.tint : c.textSecondary;
}

function CategoryTitle({ category }: { category: Category }) {
  const c = usePalette();
  const cat = CATEGORIES[category];
  return (
    <View style={[styles.catTitle, { borderBottomColor: c.border }]}>
      <View style={[styles.catDot, { backgroundColor: toneColour(c, cat.tone) }]} />
      <T kind="heading">{cat.title}</T>
    </View>
  );
}

// A round button on a closed card.
function Round({ icon, label, onPress, tone, disabled }: { icon: IconName; label: string; onPress: () => void; tone: string; disabled?: boolean }) {
  const c = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.round, { borderColor: tone, backgroundColor: c.panel, opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.92 : 1 }] }]}>
      <Icon name={icon} size={20} color={tone} />
    </Pressable>
  );
}

// One item: the closed card, and the full draft when opened.
function Row({ card, open, busy, onToggle, onApprove, onDelete, onEdit, onFull, onPhoto }: { card: InboxCard; open: boolean; busy: boolean; onToggle: () => void; onApprove: () => void; onDelete: () => void; onEdit: () => void; onFull: () => void; onPhoto: (from: 'camera' | 'library' | 'none') => void }) {
  const c = usePalette();
  const category = categoryOf(card);
  const tone = CATEGORIES[category].tone;
  const colour = toneColour(c, tone);
  const answer = card.actions === 'answer';
  const photo = card.actions === 'photo';
  const canEdit = !answer && !photo && (card.actions as string[]).includes('edit');
  // A tick straight from the closed card only for simple and not-urgent ones.
  const tick = !answer && !photo && (category === 'simple' || category === 'later');
  const preview = card.preview ?? (card.review?.text ? `“${card.review.text}”` : card.body);
  return (
    <View style={[styles.row, { backgroundColor: category === 'urgent' ? c.emberSoft : c.card, borderColor: category === 'urgent' ? c.ember : card.flagged ? c.amber : c.border, borderLeftColor: colour }]}>
      <View style={styles.rowHead}>
        <Pressable onPress={onToggle} style={styles.rowMain} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${card.title}. ${open ? 'Close' : 'Open'}`}>
          <IconTile name={typeIcon(typeOf(card).key)} tone={tone === 'neutral' ? 'neutral' : tone} />
          <View style={{ flex: 1, gap: 3 }}>
            <View style={styles.rowMeta}>
              {card.review && <Pill label={`${card.review.rating}★`} tone={card.review.rating <= 3 ? 'ember' : 'signal'} />}
              {card.flagged && <Icon name="alert-circle" size={16} color={c.amber} />}
            </View>
            <T style={{ fontWeight: '600' }} numberOfLines={open ? undefined : 1}>
              {card.title}
            </T>
            {!open && (
              <T kind="small" quiet numberOfLines={1}>
                {preview}
              </T>
            )}
          </View>
        </Pressable>
        {!open && (
          <View style={styles.rounds}>
            {photo ? (
              <Round icon="camera-outline" label={`Take a photo: ${card.title}`} tone={colour} onPress={() => onPhoto('camera')} disabled={busy} />
            ) : tick ? (
              <Round icon="checkmark" label={`Approve: ${card.title}`} tone={c.tint} onPress={onApprove} disabled={busy} />
            ) : (
              <Round icon="eye-outline" label={`Open: ${card.title}`} tone={colour} onPress={onToggle} />
            )}
            {canEdit && <Round icon="pencil" label={`Edit: ${card.title}`} tone={c.textSecondary} onPress={onEdit} disabled={busy} />}
          </View>
        )}
      </View>

      {open && (
        <View style={{ gap: Space.s + 2 }}>
          <DraftCardBody card={card} bare onOpen={onFull} />
          {photo ? (
            <>
              <Button label="Take photo" icon="camera-outline" onPress={() => onPhoto('camera')} disabled={busy} />
              <View style={styles.pair}>
                <View style={{ flex: 1 }}>
                  <Button label="Choose photo" kind="plain" small icon="images-outline" onPress={() => onPhoto('library')} disabled={busy} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Send without" kind="quiet" small icon="send-outline" onPress={() => onPhoto('none')} disabled={busy} />
                </View>
              </View>
            </>
          ) : answer ? (
            <Button label="Answer in Chat" icon="chatbubble-ellipses-outline" onPress={() => router.push({ pathname: '/conversation', params: { question: card.id } })} />
          ) : (
            <>
              <Button label={card.approveLabel ?? (card.kind === 'review_reply' ? 'Approve & post' : 'Approve')} icon="checkmark" onPress={onApprove} disabled={busy} />
              <View style={styles.pair}>
                {canEdit && (
                  <View style={{ flex: 1 }}>
                    <Button label="Edit" kind="plain" small icon="create-outline" onPress={onEdit} disabled={busy} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Button label="Delete" kind="quiet" small icon="trash-outline" onPress={onDelete} disabled={busy} />
                </View>
              </View>
            </>
          )}
        </View>
      )}

      <Pressable onPress={onToggle} hitSlop={10} accessibilityRole="button" accessibilityLabel={open ? 'Close' : 'Open'} style={styles.arrow}>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textSecondary} />
      </Pressable>
    </View>
  );
}

// Full screen: the rota, the real email, the Google post or the change, with the same
// buttons as the open card along the bottom.
function FullView({ card, busy, onClose, onApprove, onDelete, onEdit, onLook, onUseLook, onPhoto }: { card: InboxCard | null; busy: boolean; onClose: () => void; onApprove: () => void; onDelete: () => void; onEdit: () => void; onLook: () => void; onUseLook: (look: string) => void; onPhoto: (from: 'camera' | 'library') => void }) {
  const c = usePalette();
  const canEdit = Boolean(card && card.actions !== 'answer' && card.actions.includes('edit'));
  return (
    <Modal visible={Boolean(card?.view)} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]} edges={['top', 'bottom', 'left', 'right']}>
        <View style={[styles.fullHead, { borderBottomColor: c.border }]}>
          <T kind="heading" numberOfLines={1} style={{ flex: 1 }}>
            {card?.title}
          </T>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={[styles.round, { borderColor: c.border, backgroundColor: c.panel }]}>
            <Icon name="close" size={20} color={c.text} />
          </Pressable>
        </View>
        <View style={styles.fill}>
          {card && (
            <CardViewFull
              key={card.view?.type === 'email' ? `${card.id}:${card.view.lookKey ?? card.view.look}:${card.view.photo ? 'p' : 'n'}` : card.id}
              card={card}
              busy={busy}
              onUseLook={onUseLook}
              onPhoto={onPhoto}
            />
          )}
        </View>
        {/* Older app builds: the email opens in the browser sheet, so the look is changed here. */}
        {card && canChangeLook(card) && !hasWebView && (
          <View style={[styles.lookBar, { borderTopColor: c.border }]}>
            <T kind="small" quiet style={{ flex: 1 }}>
              {card.view?.type === 'email' ? card.view.look : null}
            </T>
            <Button label="Try another look" kind="plain" small icon="color-palette-outline" onPress={onLook} disabled={busy} />
          </View>
        )}
        {card && card.actions !== 'answer' && (
          <View style={[styles.fullBar, { borderTopColor: c.border, backgroundColor: c.background }]}>
            <Button label={card.approveLabel ?? 'Approve'} icon="checkmark" onPress={onApprove} disabled={busy} />
            <View style={styles.pair}>
              {canEdit && (
                <View style={{ flex: 1 }}>
                  <Button label="Edit" kind="plain" small icon="create-outline" onPress={onEdit} disabled={busy} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Button label="Delete" kind="quiet" small icon="trash-outline" onPress={onDelete} disabled={busy} />
              </View>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function EditSheet({ card, onCancel, onSend }: { card: InboxCard | null; onCancel: () => void; onSend: (card: InboxCard, words: string) => void }) {
  const c = usePalette();
  const [words, setWords] = useState('');
  return (
    <Modal visible={Boolean(card)} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <T kind="heading">What should change?</T>
          <TextInput
            value={words}
            onChangeText={setWords}
            multiline
            autoFocus
            placeholder="e.g. shorter, mention the lamb"
            placeholderTextColor={c.textSecondary}
            style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
            accessibilityLabel="What should change"
          />
          <Button label="Rewrite it" icon="sparkles-outline" onPress={() => card && words.trim() && onSend(card, words.trim())} disabled={!words.trim()} />
          <Button label="Cancel" kind="quiet" onPress={onCancel} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { gap: Space.m, padding: Space.m, paddingTop: Space.xs, width: '100%', maxWidth: MaxWidth, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  empty: { alignItems: 'center', gap: Space.s, paddingVertical: Space.l },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: Space.m },
  catTitle: { flexDirection: 'row', alignItems: 'center', gap: Space.s, paddingTop: Space.m, paddingBottom: Space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  catDot: { width: 10, height: 10, borderRadius: 5 },
  typeHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: Space.xs },
  row: { borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 3, borderRadius: 18, paddingHorizontal: Space.m - 2, paddingTop: Space.m - 2, paddingBottom: 2, gap: Space.s + 2 },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.s },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: Space.m - 4 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rounds: { gap: Space.s, alignItems: 'center' },
  round: { width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  arrow: { alignSelf: 'center', paddingHorizontal: Space.l, paddingVertical: 4 },
  pair: { flexDirection: 'row', gap: Space.s },
  float: { position: 'absolute', left: Space.m, right: Space.m, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: Space.m - 2, gap: Space.s },
  toastRow: { flexDirection: 'row', alignItems: 'center', gap: Space.s + 2 },
  reasonHead: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  undo: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  sheet: { padding: Space.l, gap: Space.m },
  fullHead: { flexDirection: 'row', alignItems: 'center', gap: Space.s, paddingHorizontal: Space.m, paddingVertical: Space.s + 2, borderBottomWidth: StyleSheet.hairlineWidth },
  fullBar: { gap: Space.s, padding: Space.m, borderTopWidth: StyleSheet.hairlineWidth },
  lookBar: { flexDirection: 'row', alignItems: 'center', gap: Space.s, paddingHorizontal: Space.m, paddingVertical: Space.s, borderTopWidth: StyleSheet.hairlineWidth },
  input: { minHeight: 120, borderWidth: 1, borderRadius: 14, padding: Space.m, fontSize: 17, textAlignVertical: 'top' },
});
