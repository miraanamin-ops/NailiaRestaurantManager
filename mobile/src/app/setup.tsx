// Setup with Dina (phase 4): the same conversation and chapters as the website's
// chat (/onboarding/chat), on its engine (/api/app/setup). Dina asks; her cards
// (questions, recaps, the allergen grid, "is this right?") answer in a tap; menu
// photos come straight from the camera. At the end: turn on alerts (asked here, with
// the reason, never on first open), then the five tabs.
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SetupCard, type CardHandlers } from '@/components/setup-cards';
import { Button, Card, T, usePalette } from '@/components/ui';
import { Brand, MaxWidth, Space } from '@/constants/theme';
import { getSetup, LoginNeeded, setupAction, setupUpload, type SetupAction, type SetupMessage, type SetupProgress } from '@/lib/api';
import { registerForAlerts } from '@/lib/notifications';
import { useSession } from '@/lib/session';

const DOC_TYPES: Record<string, string[]> = {
  photo: ['image/*'],
  document: ['application/pdf', 'image/*'],
  spreadsheet: ['text/csv', 'text/comma-separated-values', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
  any: ['image/*', 'application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
};

export default function Setup() {
  const c = usePalette();
  const { restaurantId, reloadMe, signOut } = useSession();
  const [messages, setMessages] = useState<SetupMessage[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [skippable, setSkippable] = useState(false);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [chapters, setChapters] = useState(false);
  const [alerts, setAlerts] = useState(false);
  const busy = useRef(false);

  const send = useCallback(
    async (action: SetupAction, ownerText?: string) => {
      if (!restaurantId || busy.current) return;
      busy.current = true;
      setError(null);
      if (ownerText) {
        // Everything Dina asked before this counts as answered now.
        setMessages((m) => [...(m ?? []).map((x) => (x.role === 'dina' ? { ...x, answered: true } : x)), { id: `mine-${Date.now()}`, role: 'owner', text: ownerText }]);
      }
      setTyping(true);
      try {
        const out = await setupAction(restaurantId, action);
        setMessages((m) => [...(m ?? []), ...out.messages]);
        if (out.progress) setProgress(out.progress);
        setSkippable(out.skippable);
        if (out.error) setError(out.error);
      } catch (err) {
        if (err instanceof LoginNeeded) return signOut();
        setError("I couldn't reach Dina. Check your signal and try again.");
      } finally {
        setTyping(false);
        busy.current = false;
      }
    },
    [restaurantId, signOut],
  );

  useEffect(() => {
    if (!restaurantId) return;
    getSetup(restaurantId)
      .then((s) => {
        setMessages(s.messages);
        setChosen(s.chosen);
        setProgress(s.progress);
        setSkippable(s.skippable);
        // The very first visit: Dina says hello.
        if (s.needsStart) send({ kind: 'start' });
      })
      .catch((err) => (err instanceof LoginNeeded ? signOut() : setError("Can't reach DinerAI. Check your signal and try again.")));
  }, [restaurantId, send, signOut]);

  // camera: one photo (a menu page); photos: from the library, up to 10; files: a PDF, CSV or Excel file.
  async function upload(mode: 'camera' | 'photos' | 'files', accept: 'photo' | 'document' | 'spreadsheet' | 'any' = 'any') {
    if (!restaurantId || busy.current) return;
    let files: { uri: string; name: string; type: string; size: number }[] = [];
    if (mode === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return setError('DinerAI needs the camera to photograph your menu. You can turn it on in Settings.');
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (r.canceled) return;
      files = r.assets.map((a, i) => ({ uri: a.uri, name: `photo-${i + 1}.jpg`, type: a.mimeType ?? 'image/jpeg', size: a.fileSize ?? 0 }));
    } else if (mode === 'photos') {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: true, selectionLimit: 10 });
      if (r.canceled) return;
      files = r.assets.map((a, i) => ({ uri: a.uri, name: a.fileName && !/\.hei[cf]$/i.test(a.fileName) ? a.fileName : `photo-${i + 1}.jpg`, type: a.mimeType ?? 'image/jpeg', size: a.fileSize ?? 0 }));
    } else {
      const d = await DocumentPicker.getDocumentAsync({ type: DOC_TYPES[accept] ?? DOC_TYPES.any, multiple: true, copyToCacheDirectory: true });
      if (d.canceled) return;
      files = d.assets.slice(0, 10).map((a) => ({ uri: a.uri, name: a.name, type: a.mimeType ?? 'application/octet-stream', size: a.size ?? 0 }));
    }
    if (!files.length) return;
    setTyping(true);
    try {
      const paths = await setupUpload(restaurantId, files);
      if (!Array.isArray(paths)) return setError(paths.refused);
      setTyping(false);
      await send({ kind: 'files', paths }, `📎 ${files.length === 1 ? files[0].name : `${files.length} files`}`);
    } catch (err) {
      if (err instanceof LoginNeeded) return signOut();
      setError('The upload stopped. Check your signal and try again.');
    } finally {
      setTyping(false);
    }
  }

  const handlersFor = (m: SetupMessage): CardHandlers => ({
    answer: (choiceId, label) => {
      setChosen((x) => ({ ...x, [m.id]: choiceId }));
      send({ kind: 'answer', messageId: m.id, choiceId, label }, label);
    },
    pick: (a) => {
      setChosen((x) => ({ ...x, [m.id]: a.choiceIds.join(',') }));
      send({ kind: 'pick', messageId: m.id, choiceIds: a.choiceIds, ...(a.text ? { text: a.text } : {}), ...(a.grid ? { grid: a.grid } : {}), label: a.label.slice(0, 200) }, a.label);
    },
    confirm: (changes) => send({ kind: 'confirm', messageId: m.id, changes }, Object.keys(changes).length ? `Changes: ${Object.values(changes).join(', ')}` : 'Looks right'),
    upload,
    finish: () => setAlerts(true),
  });

  function sendTyped() {
    const words = text.trim();
    if (!words) return;
    setText('');
    send({ kind: 'message', text: words }, words);
  }

  async function finish(turnOn: boolean) {
    if (turnOn) await registerForAlerts(true);
    setAlerts(false);
    await reloadMe(); // setup is finished: the tabs take over
  }

  const rows = [...(typing ? [{ key: 'typing' as const }] : []), ...[...(messages ?? [])].reverse().map((m) => ({ key: m.id, m }))];
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <View style={[styles.header, { borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <T kind="heading">Setup with Dina</T>
            {progress?.chapter ? (
              <T kind="small" quiet>
                Chapter {progress.chapter.n} of {progress.chapter.total}: {progress.chapter.title}
              </T>
            ) : progress ? (
              <T kind="small" quiet>
                Step {progress.position} of {progress.total}
              </T>
            ) : null}
          </View>
          {progress?.chapters?.length ? <Button label="Chapters" kind="plain" onPress={() => setChapters(true)} /> : null}
        </View>

        {messages === null ? (
          <ActivityIndicator style={styles.fill} />
        ) : (
          <FlatList
            inverted
            data={rows}
            keyExtractor={(r) => r.key}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            renderItem={({ item }) =>
              'm' in item ? (
                <View style={styles.item}>
                  {item.m.text ? <Bubble owner={item.m.role === 'owner'} text={item.m.text} /> : null}
                  {item.m.component ? <SetupCard c={item.m.component} done={Boolean(item.m.answered) || typing} chosen={chosen[item.m.id]} on={handlersFor(item.m)} /> : null}
                </View>
              ) : (
                <View style={[styles.bubble, styles.theirs, styles.typing, { backgroundColor: c.card, borderColor: c.border }]} accessibilityLabel="Dina is typing">
                  <ActivityIndicator size="small" />
                  <T kind="small" quiet>
                    Dina is typing…
                  </T>
                </View>
              )
            }
          />
        )}

        {error && (
          <Pressable onPress={() => setError(null)} style={[styles.note, { backgroundColor: c.card, borderColor: Brand.ember }]} accessibilityRole="button" accessibilityHint="Dismisses this note">
            <T kind="small" style={{ flex: 1 }}>
              {error}
            </T>
            <T kind="small" quiet>
              ✕
            </T>
          </Pressable>
        )}

        {skippable && !typing && (
          <View style={styles.skip}>
            <Button label={progress?.chapter ? 'Do this chapter later' : 'Skip for now'} kind="plain" onPress={() => send({ kind: 'skip' }, progress?.chapter ? 'Do this chapter later' : 'Skip for now')} />
          </View>
        )}
        <View style={[styles.bar, { borderColor: c.border }]}>
          <Pressable onPress={() => upload('camera')} disabled={typing} hitSlop={6} accessibilityRole="button" accessibilityLabel="Take a photo" style={styles.icon}>
            <T>📷</T>
          </Pressable>
          <Pressable onPress={() => upload('photos')} disabled={typing} hitSlop={6} accessibilityRole="button" accessibilityLabel="Choose photos" style={styles.icon}>
            <T>🖼️</T>
          </Pressable>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Reply to Dina"
            placeholderTextColor={c.textSecondary}
            multiline
            maxLength={2000}
            maxFontSizeMultiplier={1.6}
            accessibilityLabel="Reply to Dina"
            style={[styles.input, { color: c.text, backgroundColor: c.card, borderColor: c.border }]}
          />
          <Pressable
            onPress={sendTyped}
            disabled={!text.trim() || typing}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={[styles.send, { opacity: !text.trim() || typing ? 0.4 : 1 }]}>
            <T style={{ color: Brand.onSignal, fontWeight: '700' }}>↑</T>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={chapters} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setChapters(false)}>
        <View style={[styles.sheet, { backgroundColor: c.background }]}>
          <T kind="heading">Your setup</T>
          {progress?.chapters?.map((ch) => (
            <Pressable
              key={ch.key}
              onPress={() => {
                setChapters(false);
                send({ kind: 'jump', step: ch.key }, `Let's do ${ch.title.toLowerCase()} now`);
              }}
              accessibilityRole="button"
              style={[styles.chapter, { borderColor: c.border, backgroundColor: c.card }]}>
              <T style={{ fontWeight: '600' }}>
                {ch.status === 'done' ? '✓ ' : ''}
                {ch.title}
              </T>
              {ch.left.length ? (
                <T kind="small" quiet>
                  Still to do: {ch.left.join(', ')}
                </T>
              ) : null}
            </Pressable>
          ))}
          <Button label="Close" kind="plain" onPress={() => setChapters(false)} />
        </View>
      </Modal>

      <Modal visible={alerts} animationType="fade" transparent onRequestClose={() => finish(false)}>
        <View style={styles.backdrop}>
          <Card>
            <T kind="heading">Turn on alerts</T>
            <T>So DinerAI can tell you when there’s something to approve: your morning brief, and straight away for anything urgent, like a 1 to 3 star review.</T>
            <T kind="small" quiet>
              Nothing goes out without your approval, and nothing buzzes in your quiet hours.
            </T>
            <Button label="Turn on alerts" onPress={() => finish(true)} />
            <Button label="Not now" kind="plain" onPress={() => finish(false)} />
          </Card>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Bubble({ owner, text }: { owner: boolean; text: string }) {
  const c = usePalette();
  return (
    <View style={[styles.bubble, owner ? styles.mine : styles.theirs, { backgroundColor: owner ? Brand.signal : c.card, borderColor: owner ? Brand.signal : c.border }]}>
      <T style={{ color: owner ? Brand.onSignal : c.text }} selectable>
        {text}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Space.m, paddingBottom: Space.s, borderBottomWidth: StyleSheet.hairlineWidth, width: '100%', maxWidth: MaxWidth, alignSelf: 'center' },
  list: { padding: Space.m, gap: Space.s, width: '100%', maxWidth: MaxWidth, alignSelf: 'center', flexGrow: 1 },
  item: { gap: Space.s },
  bubble: { maxWidth: '88%', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: Space.m - 2, paddingVertical: Space.s + 1 },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  theirs: { alignSelf: 'flex-start', borderBottomLeftRadius: 6 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  note: { marginHorizontal: Space.m, marginBottom: Space.s, borderWidth: 1, borderRadius: 12, padding: Space.s + 4, flexDirection: 'row', gap: Space.s },
  skip: { paddingHorizontal: Space.m },
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, padding: Space.s, borderTopWidth: StyleSheet.hairlineWidth },
  icon: { width: 38, height: 44, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 44, maxHeight: 140, borderWidth: 1, borderRadius: 22, paddingHorizontal: Space.m - 2, paddingTop: 11, paddingBottom: 11, fontSize: 17 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: Brand.signal, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  sheet: { flex: 1, padding: Space.l, gap: Space.s },
  chapter: { borderWidth: 1, borderRadius: 14, padding: Space.m, gap: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: Space.l },
});
