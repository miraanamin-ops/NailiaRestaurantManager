// More > Settings (phase 5): opening hours, how replies sound, the sign-up reward,
// the discount cap, sending hours, quiet hours, the brief time and notifications.
// Each section saves on its own, through the website's own code: every change is in
// the activity log, and UNDO (in Chat or the Inbox) puts the last one back.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, TextInput, View, type TextInputProps } from 'react-native';

import { Button, Card, Screen, T, usePalette } from '@/components/ui';
import { Brand, Space, TapHeight } from '@/constants/theme';
import { getSettings, LoginNeeded, saveSettings, type AlertKind, type Settings, type SettingsChange } from '@/lib/api';
import { useSession } from '@/lib/session';

const ALERTS: { key: AlertKind; title: string; detail: string }[] = [
  { key: 'brief', title: 'Morning brief', detail: 'Once a day, at your brief time' },
  { key: 'urgent', title: 'Urgent alerts', detail: '1 to 3 star reviews and unhappy customers' },
  { key: 'updates', title: 'Updates', detail: 'The rota, things you asked for, and other news' },
  { key: 'reports', title: 'Reports', detail: 'Your weekly and monthly reports' },
  { key: 'nudge', title: 'Reminders', detail: 'A nudge if you haven’t opened the app in a few days' },
];
const hourLabel = (h: number) => (h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`);

export default function SettingsScreen() {
  const { restaurantId, signOut } = useSession();
  const [s, setS] = useState<Settings | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    getSettings(restaurantId)
      .then(setS)
      .catch((err) => (err instanceof LoginNeeded ? signOut() : setNote({ text: "Can't reach DinerAI. Check your signal and try again.", ok: false })));
  }, [restaurantId, signOut]);

  async function save(section: string, change: SettingsChange) {
    setBusy(section);
    setNote(null);
    try {
      const out = await saveSettings(restaurantId, change);
      if ('problem' in out) setNote({ text: out.problem, ok: false });
      else {
        setS(out);
        setNote({ text: 'Saved. Changed your mind? UNDO in Chat puts it back.', ok: true });
      }
    } catch {
      setNote({ text: 'That didn’t save. Check your signal and try again.', ok: false });
    } finally {
      setBusy(null);
    }
  }

  if (!s) {
    return <Screen kind="pushed">{note ? <T>{note.text}</T> : <ActivityIndicator />}</Screen>;
  }
  return (
    <Screen kind="pushed">
      {note && (
        <Card accent={!note.ok}>
          <T>{note.text}</T>
        </Card>
      )}
      <Hours key={JSON.stringify(s.hours)} s={s} busy={busy === 'hours'} onSave={(hours) => save('hours', { hours })} />
      <Offers key={`${s.signupReward}-${s.discountCap}`} s={s} busy={busy === 'offers'} onSave={(c) => save('offers', c)} />
      <Voice key={JSON.stringify(s.voice)} s={s} busy={busy === 'voice'} onSave={(voice) => save('voice', { voice })} />
      <Timing key={JSON.stringify([s.sendWindow, s.quietHours, s.briefHour])} s={s} busy={busy === 'timing'} onSave={(c) => save('timing', c)} />
      <Card>
        <T kind="heading">Notifications</T>
        <T kind="small" quiet>
          Switched off, nothing buzzes your phone for it; it still waits for you in the app.
        </T>
        {ALERTS.map((a) => (
          <View key={a.key} style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <T>{a.title}</T>
              <T kind="small" quiet>
                {a.detail}
              </T>
            </View>
            <Switch value={s.alerts[a.key]} onValueChange={(on) => save('alerts', { alerts: { [a.key]: on } })} trackColor={{ true: Brand.signal }} accessibilityLabel={a.title} />
          </View>
        ))}
      </Card>
    </Screen>
  );
}

function Field({ label, ...rest }: TextInputProps & { label: string }) {
  const c = usePalette();
  return (
    <View style={{ gap: 4, flex: 1 }}>
      <T kind="small" quiet>
        {label}
      </T>
      <TextInput {...rest} accessibilityLabel={label} placeholderTextColor={c.textSecondary} style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.background }]} />
    </View>
  );
}

function Hours({ s, busy, onSave }: { s: Settings; busy: boolean; onSave: (h: Settings['hours']) => void }) {
  const c = usePalette();
  const [hours, setHours] = useState(s.hours);
  return (
    <Card>
      <T kind="heading">Opening hours</T>
      <T kind="small" quiet>
        e.g. 12:00 – 22:00, or Closed. Changes also go to your Google profile once you approve them.
      </T>
      {hours.map((h, i) => (
        <View key={h.day} style={styles.hourRow}>
          <T style={{ width: 100 }}>{h.day}</T>
          <TextInput
            value={h.value}
            onChangeText={(v) => setHours(hours.map((x, j) => (j === i ? { ...x, value: v } : x)))}
            placeholder="Closed"
            accessibilityLabel={`${h.day} hours`}
            placeholderTextColor={c.textSecondary}
            style={[styles.input, { flex: 1, color: c.text, borderColor: c.border }]}
          />
        </View>
      ))}
      <Button label="Save hours" onPress={() => onSave(hours)} busy={busy} />
    </Card>
  );
}

function Offers({ s, busy, onSave }: { s: Settings; busy: boolean; onSave: (c: SettingsChange) => void }) {
  const [reward, setReward] = useState(s.signupReward);
  const [cap, setCap] = useState(String(s.discountCap));
  return (
    <Card>
      <T kind="heading">Offers</T>
      <Field label="Sign-up reward (what new customers get)" value={reward} onChangeText={setReward} placeholder="e.g. Free dessert on your next visit" />
      <Field label="Discount cap (%): no offer can go above this" value={cap} onChangeText={setCap} keyboardType="number-pad" />
      <Button label="Save offers" onPress={() => onSave({ signupReward: reward, discountCap: Number(cap) })} busy={busy} />
    </Card>
  );
}

function Voice({ s, busy, onSave }: { s: Settings; busy: boolean; onSave: (v: NonNullable<SettingsChange['voice']>) => void }) {
  const [v, setV] = useState(s.voice);
  const emoji = (key: keyof Settings['voice']['emoji'], label: string) => (
    <View style={{ gap: 4 }}>
      <T kind="small" quiet>
        {label}
      </T>
      <Chips values={[0, 1, 2, 3]} value={v.emoji[key]} label={(n) => (n === 0 ? 'None' : String(n))} onPick={(n) => setV({ ...v, emoji: { ...v.emoji, [key]: n } })} />
    </View>
  );
  return (
    <Card>
      <T kind="heading">How replies sound</T>
      <Field label="Sign-off name (e.g. Sam, or The Ember & Spice team)" value={v.signOffName} onChangeText={(x) => setV({ ...v, signOffName: x })} />
      <Field label="Greeting (e.g. Hi, or Salaam)" value={v.greeting} onChangeText={(x) => setV({ ...v, greeting: x })} />
      <Field label="Words never to use (commas between)" value={v.wordsToAvoid} onChangeText={(x) => setV({ ...v, wordsToAvoid: x })} />
      {emoji('reviewReplies', 'Emojis in review replies')}
      {emoji('posts', 'Emojis in Google posts')}
      {emoji('campaigns', 'Emojis in emails')}
      <Button label="Save" onPress={() => onSave(v)} busy={busy} />
    </Card>
  );
}

function Timing({ s, busy, onSave }: { s: Settings; busy: boolean; onSave: (c: SettingsChange) => void }) {
  const [send, setSend] = useState(s.sendWindow);
  const [quiet, setQuiet] = useState(s.quietHours);
  const [brief, setBrief] = useState(s.briefHour);
  return (
    <Card>
      <T kind="heading">Timing</T>
      <T kind="small" quiet>
        Your morning brief
      </T>
      <Chips values={[7, 8, 9, 10, 11]} value={brief} label={hourLabel} onPick={setBrief} />
      <View style={styles.pair}>
        <Field label="Emails go out from" value={send.start} onChangeText={(x) => setSend({ ...send, start: x })} placeholder="09:00" />
        <Field label="until" value={send.end} onChangeText={(x) => setSend({ ...send, end: x })} placeholder="21:00" />
      </View>
      <View style={styles.pair}>
        <Field label="Quiet hours from" value={quiet.start} onChangeText={(x) => setQuiet({ ...quiet, start: x })} placeholder="23:00" />
        <Field label="until" value={quiet.end} onChangeText={(x) => setQuiet({ ...quiet, end: x })} placeholder="09:00" />
      </View>
      <T kind="small" quiet>
        No alerts reach you in your quiet hours (UK time); they wait until the morning.
      </T>
      <Button label="Save timing" onPress={() => onSave({ briefHour: brief, sendWindow: send, quietHours: quiet })} busy={busy} />
    </Card>
  );
}

function Chips({ values, value, label, onPick }: { values: number[]; value: number; label: (n: number) => string; onPick: (n: number) => void }) {
  const c = usePalette();
  return (
    <View style={styles.chips}>
      {values.map((n) => {
        const on = n === value;
        return (
          <Pressable
            key={n}
            onPress={() => onPick(n)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[styles.chip, { borderColor: on ? Brand.signal : c.border, backgroundColor: on ? Brand.signal : 'transparent' }]}>
            <T kind="small" style={{ color: on ? Brand.onSignal : c.text, fontWeight: '600' }}>
              {label(n)}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: TapHeight, borderWidth: 1, borderRadius: 12, paddingHorizontal: Space.m, fontSize: 17 },
  hourRow: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  pair: { flexDirection: 'row', gap: Space.s },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Space.m, minHeight: 52 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Space.m, minHeight: 40, justifyContent: 'center' },
});
