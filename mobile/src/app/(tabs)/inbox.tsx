// The Inbox (phase 1): every draft waiting, one card at a time, urgent first.
// Approve: a 5-second "Undo" window, then it goes to the server and through every
// safety check. Skip: asks why in one tap (optional). Edit: type what to change;
// the draft comes back rewritten and checked, for a decision.
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { DraftCardBody, SwipeableCard } from '@/components/draft-card';
import { Button, Card, Screen, T, usePalette } from '@/components/ui';
import { Brand, Space, TapHeight } from '@/constants/theme';
import { decide, getInbox, LoginNeeded, undoLast, type InboxCard } from '@/lib/api';
import { setBadge } from '@/lib/notifications';
import { useSession } from '@/lib/session';

const UNDO_SECONDS = 5;
const SKIP_REASONS = ['Wrong tone', 'Wrong offer', 'Not now', 'Something else'];

type Pending = { card: InboxCard; timer: ReturnType<typeof setTimeout> };

export default function Inbox() {
  const c = usePalette();
  const { restaurantId, signOut } = useSession();
  // Set when a notification's Approve button brought the owner here.
  const { note } = useLocalSearchParams<{ note?: string }>();
  const [cards, setCards] = useState<InboxCard[] | null>(null);
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

  const current = cards?.[0] ?? null;
  const rest = cards ? cards.length - 1 : 0;
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
    drop(card.id);
    const p: Pending = { card, timer: setTimeout(sendPending, UNDO_SECONDS * 1000) };
    pendingRef.current = p;
    setPending(p);
  }

  function undoPending() {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current = null;
    setCards((list) => [p.card, ...(list ?? [])]);
    setPending(null);
    Haptics.selectionAsync().catch(() => {});
  }

  async function skip(card: InboxCard) {
    drop(card.id);
    const out = await run(card, { action: 'skip' }, 'Skipped.');
    if (out) setSkipped(card);
  }

  async function sendEdit(card: InboxCard, instructions: string) {
    setEditing(null);
    const out = await run(card, { action: 'edit', instructions }, 'Rewritten: have a look.');
    if (out?.card) setCards((list) => (list ? [out.card!, ...list.filter((x) => x.id !== card.id)] : [out.card!]));
    else await load();
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

  return (
    <Screen scroll={false}>
      <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <View style={styles.header}>
          <T kind="title">Inbox</T>
          {cards && cards.length > 0 && (
            <T quiet>
              {cards.length} waiting{rest > 0 ? ` · ${rest} after this` : ''}
            </T>
          )}
        </View>

        {note ? (
          <Card accent>
            <T>{note}</T>
            <Button label="OK" kind="plain" onPress={() => router.setParams({ note: undefined })} />
          </Card>
        ) : null}
        {error && (
          <Card>
            <T>{error}</T>
          </Card>
        )}
        {!cards && !error && <ActivityIndicator style={{ marginTop: Space.xl }} />}

        {cards && !current && (
          <Card>
            <T kind="heading">All done for now ✓</T>
            <T quiet>Nothing is waiting for you. New drafts arrive with your morning brief, and anything urgent comes straight away.</T>
          </Card>
        )}

        {current &&
          (current.actions === 'answer' ? (
            <>
              <DraftCardBody card={current} />
              <Card>
                <T>This one’s a question for you. Answering in the app comes with Chat, very soon. For now you can answer it on WhatsApp or the website.</T>
                <Button label="Next" kind="plain" onPress={() => setCards((list) => (list ? [...list.slice(1), list[0]] : list))} />
              </Card>
            </>
          ) : (
            <>
              <SwipeableCard key={current.id} card={current} enabled={!busy} onApprove={() => approve(current)} onSkip={() => skip(current)} />
              <View style={styles.buttons}>
                <ActionButton label="Skip" onPress={() => skip(current)} disabled={busy} color={c.textSecondary} />
                {current.actions.includes('edit') && <ActionButton label="Edit" onPress={() => setEditing(current)} disabled={busy} color={c.text} />}
                <ActionButton label="Approve" onPress={() => approve(current)} disabled={busy} main />
              </View>
              <T kind="small" quiet style={styles.center}>
                Or swipe the card: right to approve, left to skip.
              </T>
            </>
          ))}

        {busy && <ActivityIndicator />}
        <Button label="Undo my last decision" kind="plain" onPress={undoLastDecision} />
      </ScrollView>

      {(pending || toast) && (
        <View style={[styles.toast, { backgroundColor: c.text }]} accessibilityLiveRegion="polite">
          <T kind="small" style={{ color: c.background, flex: 1 }}>
            {pending ? 'Approved. Sending in a moment…' : toast}
          </T>
          {pending && (
            <Pressable onPress={undoPending} hitSlop={12} accessibilityRole="button">
              <T kind="small" style={{ color: Brand.signal, fontWeight: '700' }}>
                UNDO
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
    </Screen>
  );
}

function ActionButton({ label, onPress, disabled, main, color }: { label: string; onPress: () => void; disabled?: boolean; main?: boolean; color?: string }) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        { flex: main ? 1.4 : 1, backgroundColor: main ? Brand.signal : 'transparent', borderColor: main ? Brand.signal : c.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}>
      <T style={{ color: main ? Brand.onSignal : color, fontWeight: '600' }}>{label}</T>
    </Pressable>
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
          <Button label="Rewrite it" onPress={() => card && words.trim() && onSend(card, words.trim())} disabled={!words.trim()} />
          <Button label="Cancel" kind="plain" onPress={onCancel} />
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
          <Button label="No reason" kind="plain" onPress={() => onDone(null)} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  list: { gap: Space.m, paddingBottom: 120 },
  header: { gap: 2 },
  buttons: { flexDirection: 'row', gap: Space.s },
  action: { minHeight: TapHeight, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  toast: { position: 'absolute', left: Space.m, right: Space.m, bottom: Space.m, borderRadius: 14, padding: Space.m, flexDirection: 'row', alignItems: 'center', gap: Space.m },
  sheet: { padding: Space.l, gap: Space.m },
  input: { minHeight: 120, borderWidth: 1, borderRadius: 12, padding: Space.m, fontSize: 17, textAlignVertical: 'top' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  reasons: { padding: Space.l, gap: Space.s, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
});
