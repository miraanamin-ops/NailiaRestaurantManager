// More > Help (phase 5): the owner help guide (the same one the assistant answers
// "how do I...?" from), searchable, and Talk to a person (an email to support).
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Screen, T, usePalette } from '@/components/ui';
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
    <Screen>
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
        return (
          <Card key={s.title}>
            <Button label={`${expanded ? '▾' : '▸'} ${s.title}`} kind="plain" onPress={() => setOpen(open === s.title ? null : s.title)} />
            {expanded && (
              <View style={{ gap: Space.xs }}>
                {paragraphs(s.lines).map((l, i) => (
                  <Line key={i} text={l} />
                ))}
              </View>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: TapHeight, borderWidth: 1, borderRadius: 12, paddingHorizontal: Space.m, fontSize: 17 },
  bullet: { paddingLeft: Space.s },
});
