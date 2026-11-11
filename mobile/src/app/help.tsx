// More > Help (phase 5): the owner help guide (the same one the assistant answers
// "how do I...?" from), searchable, and Talk to a person (an email to support). Each
// section is a card that opens in place, like the Inbox's: the title and its first line
// closed, the whole section open, the arrow at the bottom.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, LayoutAnimation, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Icon, IconTile, Screen, T, usePalette, type IconName } from '@/components/ui';
import { Space, TapHeight } from '@/constants/theme';
import { getHelp } from '@/lib/api';
import { useSession } from '@/lib/session';

type Section = { title: string; lines: string[] };

// The guide's "## " sections, each with its lines (### becomes a bold line).
function sections(md: string): Section[] {
  const out: Section[] = [];
  for (const line of md.split('\n')) {
    if (line.startsWith('## ')) out.push({ title: line.slice(3).trim(), lines: [] });
    else if (out.length && line.trim() !== '---') out.at(-1)!.lines.push(line);
  }
  return out;
}

// One paragraph or bullet, with **bold** drawn bold.
function Line({ text }: { text: string }) {
  const bullet = /^\s*- /.test(text);
  const heading = text.startsWith('### ');
  const body = text.replace(/^\s*- /, '').replace(/^### /, '');
  const parts = body.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <T kind={heading ? 'body' : 'small'} style={[bullet && styles.bullet, heading && { fontWeight: '700', marginTop: Space.s }]}>
      {bullet ? '• ' : ''}
      {parts.map((p, i) =>
        p.startsWith('**') ? (
          <T key={i} kind={heading ? 'body' : 'small'} style={{ fontWeight: '700' }}>
            {p.slice(2, -2)}
          </T>
        ) : (
          p
        ),
      )}
    </T>
  );
}

// Lines that continue a paragraph or bullet are joined to it.
function paragraphs(lines: string[]) {
  const out: string[] = [];
  for (const l of lines) {
    if (!l.trim()) out.push('');
    else if (out.length && out.at(-1) !== '' && !/^\s*- /.test(l) && !l.startsWith('### ') && !out.at(-1)!.startsWith('### ')) out[out.length - 1] += ` ${l.trim()}`;
    else out.push(l);
  }
  return out.filter((x) => x.trim());
}

// An icon for a section, from the words in its title.
function iconFor(title: string): IconName {
  const t = title.toLowerCase();
  if (/review/.test(t)) return 'star-outline';
  if (/google|post|photo/.test(t)) return 'image-outline';
  if (/email|offer|campaign|customer/.test(t)) return 'mail-outline';
  if (/sales|till|takings|forecast|report/.test(t)) return 'stats-chart-outline';
  if (/rota|team|staff/.test(t)) return 'people-outline';
  if (/menu|allergen|dish/.test(t)) return 'restaurant-outline';
  if (/hours|brief|morning|time/.test(t)) return 'time-outline';
  if (/pause|safe|check|privacy|data/.test(t)) return 'shield-checkmark-outline';
  if (/bill|pay|subscription|price/.test(t)) return 'card-outline';
  if (/setup|start|onboard/.test(t)) return 'rocket-outline';
  return 'help-circle-outline';
}

export default function Help() {
  const c = usePalette();
  const { me } = useSession();
  const [guide, setGuide] = useState<{ markdown: string; supportEmail: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    getHelp()
      .then(setGuide)
      .catch(() => setFailed(true));
  }, []);

  const shown = useMemo(() => {
    const all = guide ? sections(guide.markdown) : [];
    const q = search.trim().toLowerCase();
    return q ? all.filter((s) => `${s.title}\n${s.lines.join('\n')}`.toLowerCase().includes(q)) : all;
  }, [guide, search]);

  const email = guide?.supportEmail ?? 'support@dinerai.co.uk';
  const talk = () => Linking.openURL(`mailto:${email}?subject=${encodeURIComponent('Help with DinerAI')}&body=${encodeURIComponent(`\n\n(From the app${me?.email ? `, ${me.email}` : ''})`)}`);

  return (
    <Screen kind="pushed">
      <Card>
        <T kind="heading">Talk to a person</T>
        <T kind="small" quiet>
          Email the DinerAI team and we’ll get back to you. Or just ask in Chat: “how do I…?”
        </T>
        <Button label={`Email ${email}`} onPress={talk} />
      </Card>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search the help"
        placeholderTextColor={c.textSecondary}
        autoCorrect={false}
        clearButtonMode="while-editing"
        accessibilityLabel="Search the help"
        style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
      />
      {!guide && !failed && <ActivityIndicator />}
      {failed && <T>Couldn’t load the help just now.</T>}
      {shown.map((s) => {
        const expanded = open === s.title || Boolean(search.trim());
        const body = paragraphs(s.lines);
        const first = body.find((l) => !l.startsWith('### '))?.replace(/^\s*- /, '').replace(/\*\*/g, '') ?? '';
        return (
          <Pressable
            key={s.title}
            onPress={() => {
              LayoutAnimation.easeInEaseOut();
              setOpen(open === s.title ? null : s.title);
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={s.title}
            style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderColor: expanded ? c.tint : c.border, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
            <View style={styles.head}>
              <IconTile name={iconFor(s.title)} tone={expanded ? 'signal' : 'neutral'} />
              <View style={{ flex: 1, gap: 3 }}>
                <T style={{ fontWeight: '600' }}>{s.title}</T>
                {!expanded && first ? (
                  <T kind="small" quiet numberOfLines={2}>
                    {first}
                  </T>
                ) : null}
              </View>
            </View>
            {expanded && (
              <View style={{ gap: Space.xs + 2 }}>
                {body.map((l, i) => (
                  <Line key={i} text={l} />
                ))}
              </View>
            )}
            <View style={styles.arrow}>
              <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.textSecondary} />
            </View>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: TapHeight, borderWidth: 1, borderRadius: 12, paddingHorizontal: Space.m, fontSize: 17 },
  bullet: { paddingLeft: Space.s },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: Space.m - 2, paddingTop: Space.m - 2, paddingBottom: 2, gap: Space.s + 2 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.m - 4 },
  arrow: { alignSelf: 'center', paddingVertical: 4 },
});
