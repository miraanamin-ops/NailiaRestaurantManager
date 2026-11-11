// The Inbox: everything waiting for the owner, as a list they can see at a glance and
// clear in any order (the owner's call, 12 Nov). Three groups, worked out by the server
// (lib/app/cards.ts tierOf):
//   Urgent        1 to 3 star reviews: opened first
//   Needs a look  emails to customers, anything flagged, rotas, hours, questions: opened first
//   Simple        clean 4 to 5 star replies and Google posts: Approve right on the row,
//                 or all at once ("Approve N simple items")
// Tap a row to open it: the full draft, the review it answers, the email's picture, the
// checks, and Approve / Edit / Skip. Approve: a 5-second Undo, then through every safety
// check on the server. Skip: an optional one-tap reason. Edit: say what to change.
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, LayoutAnimation, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DraftCardBody } from '@/components/draft-card';
import { Button, Card, Icon, IconTile, Pill, SectionTitle, T, TabHeader, usePalette } from '@/components/ui';
import { MaxWidth, Space } from '@/constants/theme';
import { approveSimple, decide, getInbox, LoginNeeded, undoLast, type InboxCard } from '@/lib/api';
import { kindIcon } from '@/lib/kinds';
import { setBadge } from '@/lib/notifications';
import { useSession } from '@/lib/session';

const UNDO_SECONDS = 5;
const SKIP_REASONS = ['Wrong tone', 'Wrong offer', 'Not now', 'Something else'];

type Pending = { card: InboxCard; timer: ReturnType<typeof setTimeout> };
const tierOf = (c: InboxCard) => c.tier ?? (c.urgent ? 'urgent' : 'look');

export default function Inbox() {
  const c = usePalette();
  const { me, restaurantId, signOut } = useSession();
  // Set when a notification's Approve button brought the owner here.
  const { note } = useLocalSearchParams<{ note?: string }>();
  const [cards, setCards] = useState<InboxCard[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [editing, setEditing] = useState<InboxCard | null>(null);
  const [skipped, setSkipped] = useState<InboxCard | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // An approval in its undo window. A second approval, or leaving the screen,
  // sends the waiting one straight away rather than losing it.
  const pendingRef = useRef<Pending | null>(null);
  const flushRef = useRef<() => void>(() => {});
  const drop = (id: string) => setCards((list) => (list ? list.filter((x) => x.id !== id) : list));

  async function run(card: InboxCard, body: Parameters<typeof decide>[1], doneText: string) {
    setBusy(true);
    try {
      const out = await decide(card.id, body);
      show(out.replies[0] ?? doneText);
      return out;
    } catch (err) {
      if (err instanceof LoginNeeded) await signOut();
      else show("That didn't go through. Pull down and try again.");
      await load();
      return null;
    } finally {
      setBusy(false);
    }
  }

  function sendPending() {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current = null;
    setPending(null);
    run(p.card, { action: 'approve' }, 'Approved.');
  }
  useEffect(() => {
    flushRef.current = sendPending;
  });
  useEffect(() => () => flushRef.current(), []);

  function approve(card: InboxCard) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    sendPending();
    LayoutAnimation.easeInEaseOut();
    drop(card.id);
    setOpen(null);
    const p: Pending = { card, timer: setTimeout(sendPending, UNDO_SECONDS * 1000) };
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

  async function skip(card: InboxCard) {
    LayoutAnimation.easeInEaseOut();
    drop(card.id);
    setOpen(null);
    const out = await run(card, { action: 'skip' }, 'Skipped.');
    if (out) setSkipped(card);
  }

  async function sendEdit(card: InboxCard, instructions: string) {
    setEditing(null);
    const out = await run(card, { action: 'edit', instructions }, 'Rewritten: have a look.');
    if (out?.card) setCards((list) => (list ? list.map((x) => (x.id === card.id ? out.card! : x)) : [out.card!]));
    else await load();
  }

  const simple = (cards ?? []).filter((x) => tierOf(x) === 'simple');
  function approveAllSimple() {
    Alert.alert(
      `Approve ${simple.length} simple ${simple.length === 1 ? 'item' : 'items'}?`,
      'Replies to 4 and 5 star reviews and Google posts whose checks all passed. Each still goes through the usual checks when it’s sent.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            sendPending();
            setBusy(true);
            try {
              const out = await approveSimple(restaurantId);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              show(out.notes[0] ?? `Approved ${out.approved} ${out.approved === 1 ? 'item' : 'items'}.`);
              await load();
            } catch {
              show('That didn’t go through. Pull down and try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  function undoLastDecision() {
    Alert.alert('Undo your last decision?', 'Reverses your last approval, skip or edit where possible. An email already sent can’t be taken back.', [
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
  const groups = [
    { key: 'urgent', title: 'Urgent', tone: 'ember' as const, list: (cards ?? []).filter((x) => tierOf(x) === 'urgent') },
    { key: 'look', title: 'Needs a look', tone: 'amber' as const, list: (cards ?? []).filter((x) => tierOf(x) === 'look') },
    { key: 'simple', title: 'Simple', tone: 'signal' as const, list: simple },
  ].filter((g) => g.list.length);
  const urgent = groups.find((g) => g.key === 'urgent')?.list.length ?? 0;
  const restaurant = me?.restaurants.find((r) => r.id === restaurantId)?.name ?? null;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]} edges={['top', 'left', 'right']}>
      <TabHeader restaurant={restaurant} onRestaurant={(me?.restaurants.length ?? 0) > 1 ? () => router.navigate('/more') : undefined} />
      <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1, gap: 4 }}>
            <T kind="title">Inbox</T>
            {cards && cards.length > 0 && (
              <T kind="mono" quiet>
                {cards.length} waiting{urgent ? ` · ${urgent} urgent` : ''}
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
        {!cards && !error && <ActivityIndicator style={{ marginTop: Space.xl }} />}

        {cards && cards.length === 0 && (
          <Card>
            <View style={styles.empty}>
              <Icon name="checkmark-done-circle" size={44} color={c.tint} />
              <T kind="heading">All done for now</T>
              <T quiet style={{ textAlign: 'center' }}>
                Nothing is waiting for you. New drafts arrive with your morning brief, and anything urgent comes straight away.
              </T>
            </View>
          </Card>
        )}

        {simple.length > 0 && (
          <Card>
            <T kind="label" quiet>
              Quick clear
            </T>
            <Button label={`Approve ${simple.length} simple ${simple.length === 1 ? 'item' : 'items'}`} icon="checkmark-done" onPress={approveAllSimple} busy={busy} />
            <T kind="small" quiet>
              Replies to 4 and 5 star reviews and Google posts whose checks all passed.
            </T>
            <View style={styles.pills}>
              {groups.map((g) => (
                <Pill key={g.key} label={`${g.list.length} ${g.title.toLowerCase()}`} tone={g.tone} dot />
              ))}
            </View>
          </Card>
        )}

        {groups.map((g) => (
          <View key={g.key} style={{ gap: Space.s + 2 }}>
            <SectionTitle title={`${g.title} · ${g.list.length}`} tone={g.tone} />
            {g.list.map((card) => (
              <Row
                key={card.id}
                card={card}
                tier={g.key as 'urgent' | 'look' | 'simple'}
                open={open === card.id}
                busy={busy}
                onToggle={() => toggle(card.id)}
                onApprove={() => approve(card)}
                onSkip={() => skip(card)}
                onEdit={() => setEditing(card)}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      {(pending || toast) && (
        <View style={[styles.toast, { backgroundColor: c.card, borderColor: c.border }]} accessibilityLiveRegion="polite">
          <Icon name={pending ? 'checkmark-circle' : 'information-circle-outline'} color={c.tint} />
          <T kind="small" style={{ flex: 1 }}>
            {pending ? 'Approved. Sending in a moment…' : toast}
          </T>
          {pending && (
            <Pressable onPress={undoPending} hitSlop={12} accessibilityRole="button" style={[styles.undo, { backgroundColor: c.panel }]}>
              <T kind="mono" style={{ color: c.tint }}>
                Undo
              </T>
            </Pressable>
          )}
        </View>
      )}

      <EditSheet key={editing?.id ?? 'none'} card={editing} onCancel={() => setEditing(null)} onSend={sendEdit} />
      <SkipReasons
        card={skipped}
        onDone={async (reason) => {
          const card = skipped;
          setSkipped(null);
          if (card && reason) await run(card, { action: 'reason', reason }, 'Thanks, noted.');
        }}
      />
    </SafeAreaView>
  );
}

// One item: the compact row, and its full card when opened.
function Row({
  card,
  tier,
  open,
  busy,
  onToggle,
  onApprove,
  onSkip,
  onEdit,
}: {
  card: InboxCard;
  tier: 'urgent' | 'look' | 'simple';
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onSkip: () => void;
  onEdit: () => void;
}) {
  const c = usePalette();
  const tone = tier === 'urgent' ? 'ember' : card.flagged ? 'amber' : 'neutral';
  const preview = card.review?.text ? `“${card.review.text}”` : card.body;
  return (
    <View style={[styles.row, { backgroundColor: tier === 'urgent' ? c.emberSoft : c.card, borderColor: tier === 'urgent' ? c.ember : card.flagged ? c.amber : c.border }]}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${card.title}. ${open ? 'Close' : 'Open'}`} style={styles.rowHead}>
        <IconTile name={kindIcon(card.kind)} tone={tone === 'neutral' ? 'neutral' : tone} />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={styles.rowMeta}>
            <T kind="label" quiet numberOfLines={1} style={{ flexShrink: 1 }}>
              {card.kindLabel}
            </T>
            {card.review && <Pill label={`${card.review.rating}★`} tone={card.review.rating <= 3 ? 'ember' : 'signal'} />}
            {card.flagged && <Pill label="Check" tone="amber" icon="alert-circle-outline" />}
          </View>
          <T style={{ fontWeight: '600' }} numberOfLines={open ? undefined : 2}>
            {card.title}
          </T>
          {!open && (
            <T kind="small" quiet numberOfLines={2}>
              {preview}
            </T>
          )}
        </View>
        {tier === 'simple' && !open ? (
          <Pressable onPress={onApprove} disabled={busy} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Approve: ${card.title}`} style={[styles.quickApprove, { backgroundColor: c.signalSoft, borderColor: c.tint }]}>
            <Icon name="checkmark" size={16} color={c.tint} />
            <T kind="mono" style={{ color: c.tint }}>
              Approve
            </T>
          </Pressable>
        ) : (
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textSecondary} />
        )}
      </Pressable>

      {open && (
        <View style={{ gap: Space.s + 2 }}>
          <DraftCardBody card={card} bare />
          {card.actions === 'answer' ? (
            <Button label="Answer in Chat" icon="chatbubble-ellipses-outline" onPress={() => router.navigate({ pathname: '/chat', params: { question: card.id } })} />
          ) : (
            <>
              <Button label={card.kind === 'review_reply' ? 'Approve & post' : 'Approve'} icon="checkmark" onPress={onApprove} disabled={busy} />
              <View style={styles.pair}>
                {card.actions.includes('edit') && (
                  <View style={{ flex: 1 }}>
                    <Button label="Edit" kind="plain" small icon="create-outline" onPress={onEdit} disabled={busy} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Button label="Skip" kind="quiet" small onPress={onSkip} disabled={busy} />
                </View>
              </View>
            </>
          )}
        </View>
      )}
    </View>
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
          <T quiet>In your own words, e.g. “shorter”, “mention our new lamb dish”, “more apologetic”. I’ll rewrite it and check it again.</T>
          <TextInput
            value={words}
            onChangeText={setWords}
            multiline
            autoFocus
            placeholder="Type the change…"
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

function SkipReasons({ card, onDone }: { card: InboxCard | null; onDone: (reason: string | null) => void }) {
  const c = usePalette();
  return (
    <Modal visible={Boolean(card)} transparent animationType="fade" onRequestClose={() => onDone(null)}>
      <Pressable style={styles.backdrop} onPress={() => onDone(null)}>
        <Pressable style={[styles.reasons, { backgroundColor: c.card }]}>
          <T kind="heading">Skipped. Why didn’t it work?</T>
          <T kind="small" quiet>
            One tap helps me learn. Optional.
          </T>
          {SKIP_REASONS.map((r) => (
            <Button key={r} label={r} kind="plain" onPress={() => onDone(r)} />
          ))}
          <Button label="No reason" kind="quiet" onPress={() => onDone(null)} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { gap: Space.m, padding: Space.m, paddingTop: Space.xs, paddingBottom: 120, width: '100%', maxWidth: MaxWidth, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  empty: { alignItems: 'center', gap: Space.s, paddingVertical: Space.l },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  row: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: Space.m - 2, gap: Space.s + 2 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: Space.m - 4 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  quickApprove: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, minHeight: 40 },
  pair: { flexDirection: 'row', gap: Space.s },
  toast: { position: 'absolute', left: Space.m, right: Space.m, bottom: Space.m, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: Space.m - 2, flexDirection: 'row', alignItems: 'center', gap: Space.s + 2 },
  undo: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  sheet: { padding: Space.l, gap: Space.m },
  input: { minHeight: 120, borderWidth: 1, borderRadius: 14, padding: Space.m, fontSize: 17, textAlignVertical: 'top' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  reasons: { padding: Space.l, gap: Space.s, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
});

