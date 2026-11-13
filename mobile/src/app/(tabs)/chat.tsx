// Chat (phase 3): talk to DinerAI exactly as on WhatsApp, in the same conversation.
// Words, commands (PAUSE, UNDO, STATUS...), "Thursday is quiet", photos (a dish for
// Google, a till report) and files (menus, till exports, spreadsheets) all go to the
// WhatsApp bot's own engine on the server. DinerAI's choices come back as quick
// replies; a draft comes back as the same card as the Inbox, with its buttons.
// Newest at the bottom (an inverted list). The message bar sits above the tab bar while
// the keyboard is closed and rides on top of the keyboard while it's open, moving with it
// frame by frame as one piece (Reanimated's keyboard tracking, which also runs in Expo Go;
// the KeyboardAvoidingView it replaces jumped and left a dark band). Your message shows at
// once, and DinerAI's reply is a bouncing-dots bubble with a line saying it's working.
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInUp, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { DraftCardBody } from '@/components/draft-card';
import { Icon, IconTile, T, TabHeader, usePalette, useTabBarSpace, type IconName } from '@/components/ui';
import { Brand, MaxWidth, Space } from '@/constants/theme';
import { ApiError, focusChat, getChat, LoginNeeded, newClientId, sendChat, uploadChatFile, type ChatButton, type ChatEntry, type ChatFile, type ChatState } from '@/lib/api';
import { useSession } from '@/lib/session';

const POLL_MS = 15_000;
const FILE_TYPES = ['image/*', 'application/pdf', 'text/csv', 'text/comma-separated-values', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

// What's on screen while a message is on its way: the owner's words straight away.
type Pending = { clientId: string; text: string; file: string | null };

export default function Chat() {
  const c = usePalette();
  const { me, restaurantId, signOut } = useSession();
  // question: "Answer in Chat" from the Inbox; prefill: a report's next action ("Start in
  // Chat"), put in the box to send or change; attach: "Import a list" from Customers.
  const { question, prefill, attach } = useLocalSearchParams<{ question?: string; prefill?: string; attach?: string }>();
  const [messages, setMessages] = useState<ChatEntry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // True while a message is on its way, so the 15-second refresh doesn't overwrite it.
  const busy = useRef(false);

  // Room under the bar: above the floating tab bar when the keyboard is closed, on top of
  // the keyboard when it's open (the tab bar is hidden behind it then).
  const keyboard = useAnimatedKeyboard();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const closedRoom = Platform.OS === 'ios' ? tabSpace - 30 : 0;
  // Android's tab bar sits under the screen rather than over it, so the keyboard covers
  // it as well as the screen: take its height off.
  const androidBar = insets.bottom + 64;
  const room = useAnimatedStyle(() => {
    const kb = keyboard.height.value;
    return { paddingBottom: Platform.OS === 'ios' ? Math.max(kb, closedRoom) : Math.max(kb - androidBar, 0) };
  });

  const fail = useCallback(
    (err: unknown, words: string) => {
      if (err instanceof LoginNeeded) return signOut();
      setNote(words);
    },
    [signOut],
  );

  const take = useCallback((state: ChatState) => {
    setMessages(state.messages);
    setHasMore(state.hasMore);
    if (state.refused) setNote(state.refused);
  }, []);

  const load = useCallback(async () => {
    if (busy.current) return;
    try {
      const state = await getChat(restaurantId);
      if (!busy.current) take(state);
    } catch (err) {
      fail(err, "Can't reach DinerAI just now. I'll keep trying.");
    }
  }, [restaurantId, take, fail]);

  // Fresh on opening the tab, then every 15 seconds while it's open (an alert or a
  // draft from the morning job lands in the same conversation).
  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, POLL_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  // "Answer in Chat" from the Inbox: the question is put on screen here, with its buttons.
  useEffect(() => {
    if (!question) return;
    router.setParams({ question: undefined });
    busy.current = true;
    focusChat(restaurantId, question)
      .then(take)
      .catch((err) => fail(err, err instanceof ApiError && err.status === 409 ? 'That question has already been answered.' : "Couldn't open that question. Try again from the Inbox."))
      .finally(() => {
        busy.current = false;
      });
  }, [question, restaurantId, take, fail]);

  useEffect(() => {
    if (!prefill) return;
    router.setParams({ prefill: undefined });
    // Next tick, not inside the effect itself (React's rule against cascading renders).
    queueMicrotask(() => setText(prefill));
  }, [prefill]);

  useEffect(() => {
    if (attach !== 'file') return;
    router.setParams({ attach: undefined });
    queueMicrotask(() => {
      setNote('Choose your customer list (CSV or Excel). I’ll ask how they agreed to hear from you before anyone is emailed.');
      pickFile();
    });
    // pickFile is the same function every time it matters; only a new "attach" should run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attach]);

  async function send(body: { text?: string; payload?: string; file?: ChatFile }, shown: Pending) {
    busy.current = true;
    setPending(shown);
    setNote(null);
    try {
      take(await sendChat(restaurantId, { ...body, clientId: shown.clientId }));
    } catch (err) {
      fail(err, "That didn't reach DinerAI. Check your signal and try again.");
      // Put the words back so nothing typed is lost.
      if (body.text && !body.payload) setText((t) => t || body.text!);
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  function sendTyped() {
    const words = text.trim();
    if (!words || pending) return;
    setText('');
    send({ text: words }, { clientId: newClientId(), text: words, file: null });
  }

  function tap(b: ChatButton) {
    if (pending) return;
    send({ text: b.title, payload: b.id }, { clientId: newClientId(), text: b.title, file: null });
  }

  async function sendFile(f: { uri: string; name: string; mimeType: string | null; size: number }, photo: boolean) {
    const caption = text.trim();
    const shown: Pending = { clientId: newClientId(), text: caption, file: photo ? '📷 Photo' : `📄 ${f.name}` };
    const stop = (words: string) => {
      setNote(words);
      setText(caption);
      busy.current = false;
      setPending(null);
    };
    setText('');
    setPending(shown);
    busy.current = true;
    try {
      const up = await uploadChatFile(restaurantId, f);
      if ('refused' in up) return stop(up.refused);
      await send({ text: caption, file: up }, shown);
    } catch (err) {
      if (err instanceof LoginNeeded) return signOut();
      stop("That file didn't upload. Check your signal and try again.");
    }
  }

  async function takePhoto(from: 'camera' | 'library') {
    if (pending) return;
    if (from === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setNote(perm.canAskAgain ? 'DinerAI needs the camera to take a photo.' : 'Camera access is off for DinerAI. Turn it on in Settings, then try again.');
        if (!perm.canAskAgain) Linking.openSettings().catch(() => {});
        return;
      }
    }
    // Quality under 1 makes the phone send a normal JPEG (not Apple's HEIC) at a sensible size.
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, exif: false };
    const result = from === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const a = result.canceled ? null : result.assets[0];
    if (!a) return;
    const mimeType = a.mimeType ?? (/\.png$/i.test(a.uri) ? 'image/png' : 'image/jpeg');
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    const name = a.fileName && !/\.hei[cf]$/i.test(a.fileName) ? a.fileName : `photo.${ext}`;
    sendFile({ uri: a.uri, name, mimeType, size: a.fileSize ?? (await sizeOf(a.uri)) }, true);
  }

  async function pickFile() {
    if (pending) return;
    const result = await DocumentPicker.getDocumentAsync({ type: FILE_TYPES, copyToCacheDirectory: true });
    const a = result.canceled ? null : result.assets[0];
    if (!a) return;
    sendFile({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? null, size: a.size ?? (await sizeOf(a.uri)) }, Boolean(a.mimeType?.startsWith('image/')));
  }

  async function older() {
    if (!hasMore || loadingOlder || !messages?.length) return;
    setLoadingOlder(true);
    try {
      const page = await getChat(restaurantId, messages[0].at);
      setMessages((now) => [...page.messages, ...(now ?? [])]);
      setHasMore(page.hasMore);
    } catch (err) {
      fail(err, "Couldn't load older messages.");
    } finally {
      setLoadingOlder(false);
    }
  }

  // The list runs bottom-up: newest first in the data.
  const rows: Row[] = [
    ...(pending ? [{ key: 'typing', kind: 'typing' as const }, { key: 'pending', kind: 'pending' as const, pending }] : []),
    ...[...(messages ?? [])].reverse().map((m) => ({ key: m.id, kind: 'message' as const, m })),
  ];

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]} edges={['top', 'left', 'right']}>
      <Animated.View style={[styles.fill, { backgroundColor: c.background }, room]}>
        <View style={[styles.headerWrap, { borderColor: c.border }]}>
          <TabHeader restaurant={me?.restaurants.find((r) => r.id === restaurantId)?.name ?? null} />
          <View style={styles.header}>
            <IconTile name="sparkles" tone="signal" />
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: '600' }}>DinerAI</T>
              <T kind="caption" quiet>
                Your manager. Ask in your own words, or send a photo or file.
              </T>
            </View>
          </View>
        </View>

        {messages === null ? (
          <ActivityIndicator style={styles.fill} />
        ) : (
          <FlatList
            inverted
            data={rows}
            keyExtractor={(r) => r.key}
            renderItem={({ item }) => <ChatRow row={item} onTap={tap} disabled={Boolean(pending)} />}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onEndReached={older}
            onEndReachedThreshold={0.3}
            ListFooterComponent={loadingOlder ? <ActivityIndicator style={{ margin: Space.m }} /> : undefined}
            ListEmptyComponent={<Empty />}
          />
        )}

        {note && (
          <Pressable onPress={() => setNote(null)} style={[styles.note, { backgroundColor: c.card, borderColor: Brand.ember }]} accessibilityRole="button" accessibilityHint="Dismisses this note">
            <T kind="small" style={{ flex: 1 }}>
              {note}
            </T>
            <T kind="small" quiet>
              ✕
            </T>
          </Pressable>
        )}

        <View style={[styles.bar, { backgroundColor: c.background }]}>
          <IconButton label="Take a photo" icon="camera-outline" onPress={() => takePhoto('camera')} disabled={Boolean(pending)} />
          <IconButton label="Choose a photo" icon="image-outline" onPress={() => takePhoto('library')} disabled={Boolean(pending)} />
          <IconButton label="Send a file" icon="attach-outline" onPress={pickFile} disabled={Boolean(pending)} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message DinerAI"
            placeholderTextColor={c.textSecondary}
            multiline
            maxLength={1600}
            maxFontSizeMultiplier={1.6}
            style={[styles.input, { color: c.text, backgroundColor: c.card, borderColor: c.border }]}
            accessibilityLabel="Message DinerAI"
          />
          <Pressable
            onPress={sendTyped}
            disabled={!text.trim() || Boolean(pending)}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={({ pressed }) => [styles.send, { opacity: !text.trim() || pending ? 0.4 : pressed ? 0.8 : 1 }]}>
            <Icon name="arrow-up" size={22} color={Brand.onSignal} />
          </Pressable>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

async function sizeOf(uri: string) {
  try {
    const { File } = await import('expo-file-system');
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

type Row = { key: string; kind: 'typing' } | { key: string; kind: 'pending'; pending: Pending } | { key: string; kind: 'message'; m: ChatEntry };

function ChatRow({ row, onTap, disabled }: { row: Row; onTap: (b: ChatButton) => void; disabled: boolean }) {
  if (row.kind === 'typing') return <Typing />;
  if (row.kind === 'pending')
    return (
      // The list is upside down, so "up" here rises from below on screen.
      <Animated.View entering={FadeInUp.duration(220)}>
        <Bubble owner text={row.pending.text} file={row.pending.file} imageUrl={null} />
      </Animated.View>
    );
  const m = row.m;
  const owner = m.from === 'owner';
  // A draft shows as its Inbox card; the bot's words go above it only when they add
  // something (they usually repeat the draft).
  const intro = m.card && m.text && !m.text.includes(m.card.body.slice(0, 40)) ? m.text : null;
  return (
    <Animated.View style={styles.item} entering={FadeIn.duration(250)}>
      {m.card ? (
        <>
          {intro ? <Bubble owner={false} text={intro} file={null} imageUrl={null} /> : null}
          <DraftCardBody card={m.card} />
        </>
      ) : (
        <Bubble owner={owner} text={m.text} file={m.file && !m.file.photo ? `📄 ${m.file.name}` : null} imageUrl={m.imageUrl} via={null} />
      )}
      {m.buttons.length > 0 && <QuickReplies buttons={m.buttons} onTap={onTap} disabled={disabled} />}
    </Animated.View>
  );
}

function Bubble({ owner, text, file, imageUrl, faded, via }: { owner: boolean; text: string; file: string | null; imageUrl: string | null; faded?: boolean; via?: string | null }) {
  const c = usePalette();
  const ink = owner ? Brand.onSignal : c.text;
  return (
    <View
      style={[styles.bubble, owner ? styles.mine : styles.theirs, { backgroundColor: owner ? Brand.signal : c.card, borderColor: owner ? Brand.signal : c.border, opacity: faded ? 0.7 : 1 }]}
      accessible
      accessibilityLabel={`${owner ? 'You' : 'DinerAI'}: ${[file, text].filter(Boolean).join('. ')}`}>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.photo} contentFit="cover" accessibilityLabel={owner ? 'Your photo' : 'A picture from DinerAI'} /> : null}
      {file ? (
        <T kind="small" style={{ color: ink, fontWeight: '600' }}>
          {file}
        </T>
      ) : null}
      {text ? (
        <T style={{ color: ink }} selectable>
          {text}
        </T>
      ) : null}
      {via ? (
        <T kind="small" style={{ color: owner ? Brand.onSignal : c.textSecondary, opacity: 0.75, fontSize: 12 }}>
          on {via}
        </T>
      ) : null}
    </View>
  );
}

function QuickReplies({ buttons, onTap, disabled }: { buttons: ChatButton[]; onTap: (b: ChatButton) => void; disabled: boolean }) {
  const c = usePalette();
  return (
    <View style={styles.replies}>
      {buttons.map((b) => {
        const main = /^approve(:|$)/.test(b.id);
        return (
          <Pressable
            key={b.id}
            onPress={() => onTap(b)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={b.title}
            style={({ pressed }) => [styles.reply, { backgroundColor: main ? Brand.signal : c.card, borderColor: main ? Brand.signal : c.border, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}>
            <T kind="small" style={{ color: main ? Brand.onSignal : c.text, fontWeight: '600' }} maxFontSizeMultiplier={1.6}>
              {b.title}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

// What DinerAI is doing while it works: bouncing dots and a line that moves on with
// time (a quick command is back before the first change; a draft or a sum takes longer).
const WORKING = [
  { after: 0, line: 'Reading your message' },
  { after: 4000, line: 'Working on it' },
  { after: 12000, line: 'Nearly there, a bigger job' },
  { after: 30000, line: 'Still going, thanks for waiting' },
];

function Typing() {
  const c = usePalette();
  const [line, setLine] = useState(WORKING[0].line);
  useEffect(() => {
    const timers = WORKING.slice(1).map((w) => setTimeout(() => setLine(w.line), w.after));
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <Animated.View
      entering={FadeInUp.duration(220).delay(120)}
      style={[styles.bubble, styles.theirs, styles.typing, { backgroundColor: c.card, borderColor: c.border }]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`DinerAI: ${line}`}>
      <View style={styles.dots}>
        {[0, 1, 2].map((i) => (
          <Dot key={i} delay={i * 150} />
        ))}
      </View>
      <Animated.View key={line} entering={FadeIn.duration(300)}>
        <T kind="small" quiet>
          {line}…
        </T>
      </Animated.View>
    </Animated.View>
  );
}

function Dot({ delay }: { delay: number }) {
  const c = usePalette();
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withDelay(delay, withRepeat(withSequence(withTiming(-5, { duration: 280 }), withTiming(0, { duration: 280 })), -1));
  }, [delay, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: 0.55 + (-y.value / 5) * 0.45 }));
  return <Animated.View style={[styles.dot, { backgroundColor: c.tint }, style]} />;
}

function Empty() {
  return (
    // The list is inverted, so its empty state is turned back the right way up.
    <View style={[styles.empty, { transform: [{ scaleY: -1 }] }]}>
      <T kind="heading">Say hello 👋</T>
      <T quiet>Try “Thursday is quiet”, “how did we do last week?”, STATUS or HELP. Or send a photo of a dish or your till report.</T>
    </View>
  );
}

function IconButton({ label, icon, onPress, disabled }: { label: string; icon: IconName; onPress: () => void; disabled: boolean }) {
  const c = usePalette();
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.icon, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <Icon name={icon} size={23} color={c.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headerWrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: 'row', alignItems: 'center', gap: Space.s + 2, paddingHorizontal: Space.m, paddingBottom: Space.s + 2, width: '100%', maxWidth: MaxWidth, alignSelf: 'center' },
  list: { padding: Space.m, gap: Space.s, width: '100%', maxWidth: MaxWidth, alignSelf: 'center', flexGrow: 1 },
  item: { gap: Space.xs + 2 },
  bubble: { maxWidth: '85%', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: Space.m - 2, paddingVertical: Space.s + 1, gap: 4 },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  theirs: { alignSelf: 'flex-start', borderBottomLeftRadius: 6 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: Space.s + 2 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 18 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  photo: { width: 220, maxWidth: '100%', aspectRatio: 1, borderRadius: 12 },
  replies: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  reply: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Space.m, paddingVertical: Space.s + 2, minHeight: 44, justifyContent: 'center' },
  empty: { gap: Space.s, paddingVertical: Space.xl },
  note: { marginHorizontal: Space.m, marginBottom: Space.s, borderWidth: 1, borderRadius: 12, padding: Space.s + 4, flexDirection: 'row', gap: Space.s, alignItems: 'flex-start' },
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, paddingHorizontal: Space.s, paddingVertical: Space.s },
  icon: { width: 38, height: 44, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 44, maxHeight: 140, borderWidth: 1, borderRadius: 22, paddingHorizontal: Space.m - 2, paddingTop: 11, paddingBottom: 11, fontSize: 17 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: Brand.signal, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
});
