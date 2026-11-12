// Setup with Dina in the app (phase 4): each card the website's chat draws
// (src/components/chat/ in the web app), as native components. What a card shows comes
// from the server (the restaurant's saved details, never Dina's words); a tap becomes
// the same action the website sends (answer, pick, confirm, files...).
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, T, usePalette } from '@/components/ui';
import { Brand, Space, TapHeight } from '@/constants/theme';
import { API_URL, type ConfirmationData, type GridData, type QuestionData, type RecapData, type SetupComponent, type SetupOption, type StaffingAnswer, type StaffingData, type SummaryData } from '@/lib/api';

export type CardHandlers = {
  answer: (choiceId: string, label: string) => void; // a button (quick reply, card, step action)
  pick: (a: { choiceIds: string[]; text?: string; label: string; grid?: Record<string, string[] | 'unsure'>; staffing?: StaffingAnswer }) => void; // a question card or recap
  confirm: (changes: Record<string, string>) => void; // "Looks right" / changes
  upload: (mode: 'camera' | 'photos' | 'files', accept: 'photo' | 'document' | 'spreadsheet' | 'any') => void; // camera, photos or a file
  finish: () => void; // the summary's "Go to DinerAI"
};

const full = (href: string) => (/^https?:/.test(href) ? href : `${API_URL}${href}`);

export function SetupCard({ c, done, chosen, on }: { c: SetupComponent; done: boolean; chosen?: string; on: CardHandlers }) {
  switch (c.type) {
    case 'quick_replies':
      return <Choices options={c.options} done={done} chosen={chosen} onPick={(o) => on.answer(o.id, o.label)} />;
    case 'choice_cards':
      return (
        <View style={styles.stack}>
          {c.quote && <Quote quote={c.quote} />}
          {c.cards.map((card) => (
            <OptionCard key={card.id} title={card.title} body={card.body} selected={chosen === card.id} disabled={done} onPress={() => on.answer(card.id, card.title)} />
          ))}
        </View>
      );
    case 'steps':
      return (
        <Card>
          <T kind="heading">{c.title}</T>
          {c.steps.map((s) => (
            <View key={s.n} style={styles.step}>
              <T style={{ fontWeight: '700' }}>{s.n}.</T>
              <View style={{ flex: 1, gap: 4 }}>
                <T>{s.text}</T>
                {s.copy ? <Button label={`Copy ${s.copy}`} kind="plain" onPress={() => Clipboard.setStringAsync(s.copy!)} /> : null}
                {s.link ? <Button label={s.link.label} kind="plain" onPress={() => WebBrowser.openBrowserAsync(full(s.link!.href))} /> : null}
              </View>
            </View>
          ))}
          {c.note ? (
            <T kind="small" quiet>
              {c.note}
            </T>
          ) : null}
          <Choices options={c.actions} done={done} chosen={chosen} onPick={(o) => on.answer(o.id, o.label)} />
        </Card>
      );
    case 'forward':
      return (
        <Card>
          <T>{c.intro}</T>
          <T selectable style={{ fontStyle: 'italic' }}>
            {c.text}
          </T>
          <Button label="Share this message" kind="plain" onPress={() => Share.share({ message: c.text })} />
        </Card>
      );
    case 'link':
      return (
        <Card>
          {c.hint ? <T quiet>{c.hint}</T> : null}
          <Button
            label={c.label}
            onPress={() => {
              WebBrowser.openBrowserAsync(full(c.href));
              if (c.continueLabel && !done) on.answer('opened', c.continueLabel);
            }}
          />
        </Card>
      );
    case 'dish_check':
      return (
        <Card>
          <T kind="label" quiet>
            Dish {c.position} of {c.total} · {c.section}
          </T>
          <T kind="heading">{c.dish}</T>
          <T quiet>{c.suggested.length ? `Suggested: ${c.suggested.join(', ')}` : 'No allergens suggested.'}</T>
          <Choices options={c.actions} done={done} chosen={chosen} onPick={(o) => on.answer(o.id, o.label)} />
        </Card>
      );
    case 'upload':
      return <UploadButtons accept={c.accept} label={c.label} done={done} onUpload={on.upload} />;
    case 'confirmation':
      return <Confirmation card={c.card} done={done} onConfirm={on.confirm} />;
    case 'summary':
      return <Summary summary={c.summary} onFinish={on.finish} />;
    case 'question':
      return <Question data={c.card} done={done} onPick={on.pick} onUpload={on.upload} />;
    case 'recap':
      return <Recap recap={c.recap} done={done} onPick={on.pick} />;
    default:
      return null;
  }
}

function Choices({ options, done, chosen, onPick }: { options: SetupOption[]; done: boolean; chosen?: string; onPick: (o: SetupOption) => void }) {
  const c = usePalette();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = chosen === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => onPick(o)}
            disabled={done}
            accessibilityRole="button"
            accessibilityState={{ disabled: done, selected: on }}
            style={({ pressed }) => [styles.chip, { borderColor: on ? Brand.signal : c.border, backgroundColor: on ? Brand.signal : c.card, opacity: done && !on ? 0.45 : pressed ? 0.75 : 1 }]}>
            <T kind="small" style={{ fontWeight: '600', color: on ? Brand.onSignal : c.text }} maxFontSizeMultiplier={1.6}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

function OptionCard({ title, body, selected, disabled, onPress, swatches }: { title: string; body?: string; selected: boolean; disabled: boolean; onPress: () => void; swatches?: string[] }) {
  const c = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [styles.option, { borderColor: selected ? Brand.signal : c.border, backgroundColor: c.card, borderWidth: selected ? 2 : 1, opacity: disabled && !selected ? 0.5 : pressed ? 0.8 : 1 }]}>
      <View style={styles.optionHead}>
        {swatches?.map((s) => <View key={s} style={[styles.swatch, { backgroundColor: s, borderColor: c.border }]} />)}
        <T style={{ fontWeight: '600', flex: 1 }}>{title}</T>
        {selected && <T style={{ color: c.tint }}>✓</T>}
      </View>
      {body ? (
        <T kind="small" quiet>
          {body}
        </T>
      ) : null}
    </Pressable>
  );
}

function Quote({ quote }: { quote: NonNullable<QuestionData['quote']> }) {
  const c = usePalette();
  return (
    <View style={[styles.quote, { borderColor: c.border }]}>
      <T kind="small" style={{ fontWeight: '600' }}>
        {quote.author} {'★'.repeat(quote.rating)}
      </T>
      <T kind="small" quiet style={{ fontStyle: 'italic' }}>
        “{quote.text}”
      </T>
      {!quote.real && (
        <T kind="small" quiet>
          A typical review, to set your tone.
        </T>
      )}
    </View>
  );
}

function UploadButtons({ accept, label, done, onUpload }: { accept: 'photo' | 'document' | 'spreadsheet' | 'any'; label: string; done: boolean; onUpload: CardHandlers['upload'] }) {
  const photos = accept === 'photo' || accept === 'any' || accept === 'document';
  return (
    <Card>
      <T>{label}</T>
      {photos && <Button label="📷 Take a photo" onPress={() => onUpload('camera', accept)} disabled={done} />}
      {photos && <Button label="Choose photos" kind="plain" onPress={() => onUpload('photos', accept)} disabled={done} />}
      {accept !== 'photo' && <Button label="📎 Choose a file" kind={photos ? 'plain' : 'main'} onPress={() => onUpload('files', accept)} disabled={done} />}
    </Card>
  );
}

function Confirmation({ card, done, onConfirm }: { card: ConfirmationData; done: boolean; onConfirm: CardHandlers['confirm'] }) {
  const c = usePalette();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(card.fields.map((f) => [f.key, f.value ?? ''])));
  const changes = () => Object.fromEntries(card.fields.filter((f) => (values[f.key] ?? '').trim() !== (f.value ?? '')).map((f) => [f.key, values[f.key].trim()]));
  return (
    <Card>
      <T kind="label" quiet>
        {card.title}
      </T>
      {card.image ? <Image source={{ uri: card.image }} style={styles.logo} contentFit="contain" accessibilityLabel="Your logo" /> : null}
      {card.fields.map((f) =>
        editing ? (
          <View key={f.key} style={{ gap: 4 }}>
            <T kind="small" quiet>
              {f.label}
            </T>
            <TextInput
              value={values[f.key]}
              onChangeText={(v) => setValues({ ...values, [f.key]: v })}
              multiline={f.multiline}
              accessibilityLabel={f.label}
              style={[styles.input, f.multiline && styles.multi, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
            />
          </View>
        ) : (
          <View key={f.key} style={styles.field}>
            <T kind="small" quiet style={{ width: 110 }}>
              {f.label}
            </T>
            {f.colour ? <View style={[styles.swatch, { backgroundColor: f.colour, borderColor: c.border }]} /> : null}
            <T style={{ flex: 1 }}>{f.value ?? '(not given yet)'}</T>
          </View>
        ),
      )}
      {!done &&
        (editing ? (
          <>
            <Button
              label="Save changes"
              onPress={() => {
                setEditing(false);
                onConfirm(changes());
              }}
            />
            <Button label="Cancel" kind="plain" onPress={() => setEditing(false)} />
          </>
        ) : (
          <>
            <Button label="Looks right" onPress={() => onConfirm({})} />
            <Button label="Change something" kind="plain" onPress={() => setEditing(true)} />
          </>
        ))}
    </Card>
  );
}

function Question({ data, done, onPick, onUpload }: { data: QuestionData; done: boolean; onPick: CardHandlers['pick']; onUpload: CardHandlers['upload'] }) {
  const c = usePalette();
  const [picked, setPicked] = useState<string[]>(data.selected ?? []);
  const [text, setText] = useState('');
  const [grid, setGrid] = useState<Record<string, string[] | 'unsure'>>(() => (data.grid ? Object.fromEntries(data.grid.rows.map((r) => [r.id, r.unsure ? 'unsure' : [...r.marked]])) : {}));
  const [staffing, setStaffing] = useState<StaffingAnswer>(() => (data.staffing ? Object.fromEntries(data.staffing.rows.map((r) => [r.role, { min: r.min, per: r.per }])) : {}));
  // The staffing card changes with its own − and +; its typed choice is for WhatsApp.
  const options = data.staffing ? data.options.filter((o) => o.id !== data.input?.optionId && o.id !== 'ok') : data.options;
  const wordsOnly = Boolean(data.input) && data.options.length === 0;
  const needsWords = Boolean(data.input) && (wordsOnly || picked.includes(data.input!.optionId));
  const ready = data.grid || data.staffing ? true : (picked.length > 0 || wordsOnly) && (!needsWords || text.trim().length > 0);
  const labelOf = (ids: string[]) => (data.grid ? 'These are right' : needsWords ? text.trim() : ids.map((id) => data.options.find((o) => o.id === id)?.label ?? id).join(', '));

  const tap = (id: string, label: string) => {
    if (done) return;
    const next = data.multi ? (picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]) : [id];
    setPicked(next);
    // Not a decision, one choice, no words: a tap is the answer.
    if (!data.confirm && !data.multi && !(data.input && id === data.input.optionId)) onPick({ choiceIds: next, label });
  };
  const confirm = () => {
    if (!ready) return;
    if (data.grid) return onPick({ choiceIds: [data.options[0]?.id ?? 'grid_ok'], grid, label: labelOf([]) });
    if (data.staffing) return onPick({ choiceIds: ['ok'], staffing, label: 'Save these numbers' });
    const ids = wordsOnly ? [data.input!.optionId] : picked;
    onPick({ choiceIds: ids, ...(needsWords ? { text: text.trim() } : {}), label: labelOf(ids) });
  };

  return (
    <View style={styles.stack}>
      {data.image ? (
        <Card>
          <Image source={{ uri: data.image }} style={styles.logo} contentFit="contain" accessibilityLabel="Your logo" />
        </Card>
      ) : null}
      {data.quote && <Quote quote={data.quote} />}
      {data.table ? <TableRows table={data.table} /> : null}
      {data.staffing ? <StaffingRows data={data.staffing} value={staffing} onChange={setStaffing} disabled={done} /> : null}
      {data.grid ? (
        <AllergenRows grid={data.grid} value={grid} onChange={setGrid} disabled={done} />
      ) : data.layout === 'buttons' && !data.multi && !data.confirm ? (
        <Choices options={options} done={done} chosen={picked[0]} onPick={(o) => tap(o.id, o.label)} />
      ) : (
        options.map((o) => <OptionCard key={o.id} title={o.label} body={o.body} swatches={o.swatches} selected={picked.includes(o.id)} disabled={done} onPress={() => tap(o.id, o.label)} />)
      )}
      {needsWords && !done && (
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={data.input!.placeholder}
          placeholderTextColor={c.textSecondary}
          multiline
          accessibilityLabel={data.input!.placeholder}
          style={[styles.input, styles.multi, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
        />
      )}
      {data.upload && !done ? <UploadButtons accept={data.upload.accept} label={data.upload.label} done={done} onUpload={onUpload} /> : null}
      {data.link ? <Button label={data.link.label} kind="plain" onPress={() => WebBrowser.openBrowserAsync(full(data.link!.href))} /> : null}
      {!done && (data.confirm || data.multi || needsWords || data.grid || data.staffing) && <Button label={data.grid ? 'These are right' : data.staffing ? 'Save these numbers' : 'Confirm'} onPress={confirm} disabled={!ready} />}
      {!done && data.skip && <Button label="Skip this question" kind="plain" onPress={() => onPick({ choiceIds: ['skip_q'], label: 'Skip this question' })} />}
    </View>
  );
}

// The past rotas read at setup: one card per person (the website shows a table).
function TableRows({ table }: { table: { columns: string[]; rows: string[][] } }) {
  return (
    <View style={styles.stack}>
      {table.rows.map((row, i) => (
        <Card key={i}>
          <T style={{ fontWeight: '600' }}>{row[0]}</T>
          <T kind="small" quiet>
            {row
              .slice(1)
              .map((cell, j) => (cell ? `${table.columns[j + 1]}: ${cell}` : null))
              .filter(Boolean)
              .join(' · ')}
          </T>
        </Card>
      ))}
    </View>
  );
}

// "How many people you need": one card per role, − and + for the minimum and for
// "1 more per N orders an hour" (the same answer goes back as on the website).
const PER_STEPS = [3, 4, 5, 6, 8, 10, 12, 15, 18, 20, 25, 30, 40, 50, 60, 80];
const nextPer = (per: number | null, dir: 1 | -1): number | null => {
  if (per === null) return dir === 1 ? PER_STEPS[0] : null;
  if (dir === 1) return PER_STEPS.find((x) => x > per) ?? null;
  return [...PER_STEPS].reverse().find((x) => x < per) ?? per;
};
function Stepper({ label, value, onDown, onUp, disabled }: { label: string; value: string; onDown: () => void; onUp: () => void; disabled: boolean }) {
  const c = usePalette();
  const btn = [styles.stepBtn, { borderColor: c.border }];
  return (
    <View style={styles.stepper}>
      <Pressable onPress={onDown} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Fewer: ${label}`} style={btn}>
        <T>−</T>
      </Pressable>
      <T style={styles.stepValue} accessibilityLiveRegion="polite">
        {value}
      </T>
      <Pressable onPress={onUp} disabled={disabled} accessibilityRole="button" accessibilityLabel={`More: ${label}`} style={btn}>
        <T>+</T>
      </Pressable>
    </View>
  );
}
function StaffingRows({ data, value, onChange, disabled }: { data: StaffingData; value: StaffingAnswer; onChange: (v: StaffingAnswer) => void; disabled: boolean }) {
  const set = (role: string, v: { min: number; per: number | null }) => onChange({ ...value, [role]: v });
  const words = (x: { min: number; per: number | null }) => `${x.min}${x.per ? `, +1 per ${x.per}` : ''}`;
  return (
    <View style={styles.stack}>
      {data.rows.map((r) => {
        const v = value[r.role] ?? { min: r.min, per: r.per };
        const basis = [r.learned ? `Your rotas: ${words(r.learned)}${r.learned.estimate ? ' (estimate)' : ''}` : null, r.suggested ? `For your size: ${words(r.suggested)}` : null, r.edges].filter(Boolean).join(' · ');
        return (
          <Card key={r.role}>
            <T style={{ fontWeight: '600' }}>{r.label}</T>
            {r.hint ? (
              <T kind="small" quiet>
                {r.hint}
              </T>
            ) : null}
            <T kind="small" quiet style={{ marginTop: Space.s }}>
              At least, whenever open
            </T>
            <Stepper label={`${r.label} at least`} value={String(v.min)} disabled={disabled} onDown={() => set(r.role, { ...v, min: Math.max(0, v.min - 1) })} onUp={() => set(r.role, { ...v, min: Math.min(20, v.min + 1) })} />
            {r.orders ? (
              <>
                <T kind="small" quiet style={{ marginTop: Space.s }}>
                  1 more per … {r.orders} an hour
                </T>
                <Stepper label={`${r.label} 1 more per`} value={v.per ? String(v.per) : 'never'} disabled={disabled} onDown={() => set(r.role, { ...v, per: nextPer(v.per, -1) })} onUp={() => set(r.role, { ...v, per: nextPer(v.per, 1) })} />
              </>
            ) : null}
            {basis ? (
              <T kind="small" quiet style={{ marginTop: Space.s }}>
                {basis}
              </T>
            ) : null}
          </Card>
        );
      })}
      {data.notes.slice(1).map((n) => (
        <T key={n} kind="small" quiet>
          {n}
        </T>
      ))}
    </View>
  );
}

// The allergen grid, for a phone: one card per dish, the allergens as chips to tick
// (the website shows a table; the same answer goes back).
function AllergenRows({ grid, value, onChange, disabled }: { grid: GridData; value: Record<string, string[] | 'unsure'>; onChange: (v: Record<string, string[] | 'unsure'>) => void; disabled: boolean }) {
  const c = usePalette();
  const toggle = (row: string, col: string) => {
    const cur = value[row];
    const marks = cur === 'unsure' ? [] : (cur ?? []);
    onChange({ ...value, [row]: marks.includes(col) ? marks.filter((x) => x !== col) : [...marks, col] });
  };
  return (
    <View style={styles.stack}>
      {grid.rows.map((r) => {
        const v = value[r.id];
        const unsure = v === 'unsure';
        const marks = unsure ? [] : (v ?? []);
        return (
          <Card key={r.id}>
            <T kind="label" quiet>
              {r.section}
            </T>
            <T style={{ fontWeight: '600' }}>{r.label}</T>
            {r.suggested && !unsure && (
              <T kind="small" quiet>
                Suggested by DinerAI: please check.
              </T>
            )}
            <View style={styles.chips}>
              {grid.columns.map((col) => {
                const on = marks.includes(col.id);
                return (
                  <Pressable
                    key={col.id}
                    onPress={() => toggle(r.id, col.id)}
                    disabled={disabled}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${r.label}: ${col.label}`}
                    accessibilityState={{ checked: on, disabled }}
                    style={[styles.smallChip, { borderColor: on ? Brand.signal : c.border, backgroundColor: on ? Brand.signal : 'transparent' }]}>
                    <T kind="small" style={{ color: on ? Brand.onSignal : c.text }} maxFontSizeMultiplier={1.4}>
                      {col.label}
                    </T>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => onChange({ ...value, [r.id]: unsure ? [] : 'unsure' })}
                disabled={disabled}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: unsure }}
                style={[styles.smallChip, { borderColor: unsure ? Brand.ember : c.border }]}>
                <T kind="small" style={{ color: unsure ? Brand.ember : c.textSecondary }}>
                  Not sure
                </T>
              </Pressable>
            </View>
          </Card>
        );
      })}
    </View>
  );
}

function Recap({ recap, done, onPick }: { recap: RecapData; done: boolean; onPick: CardHandlers['pick'] }) {
  return (
    <Card>
      <T kind="heading">{recap.title}</T>
      {recap.rows.map((r) => (
        <View key={r.q} style={styles.recapRow}>
          <View style={{ flex: 1 }}>
            <T kind="small" quiet>
              {r.label}
            </T>
            <T>{r.status === 'skipped' ? 'Skipped for now' : r.value}</T>
          </View>
          {!done && <Button label="Change" kind="plain" onPress={() => onPick({ choiceIds: [`change:${r.q}`], label: `Change: ${r.label}` })} />}
        </View>
      ))}
      {!done && <Button label="Looks right" onPress={() => onPick({ choiceIds: ['recap_ok'], label: 'Looks right' })} />}
    </Card>
  );
}

function Summary({ summary, onFinish }: { summary: SummaryData; onFinish: () => void }) {
  const c = usePalette();
  return (
    <Card accent>
      <T kind="heading">
        Set up: {summary.done} of {summary.total}
      </T>
      {summary.items.map((i) => (
        <View key={i.key} style={styles.field}>
          <T style={{ color: i.status === 'done' ? c.tint : c.textSecondary }}>{i.status === 'done' ? '✓' : '•'}</T>
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: '600' }}>{i.title}</T>
            {i.detail ? (
              <T kind="small" quiet>
                {i.detail}
              </T>
            ) : null}
          </View>
        </View>
      ))}
      {summary.locked.length > 0 && (
        <>
          <T kind="label" quiet>
            Still to do, when you’re ready
          </T>
          {summary.locked.map((l) => (
            <T key={l.key} kind="small">
              {l.title}: {l.unlock}
            </T>
          ))}
        </>
      )}
      {summary.next.map((n) => (
        <T key={n} kind="small" quiet>
          {n}
        </T>
      ))}
      {summary.dashboardHref ? <Button label="Go to DinerAI" onPress={onFinish} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Space.s, marginTop: 4 },
  stepBtn: { width: TapHeight, height: TapHeight, borderRadius: TapHeight / 2, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 64, textAlign: 'center', fontWeight: '600' },
  stack: { gap: Space.s },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Space.m, paddingVertical: Space.s + 2, minHeight: 44, justifyContent: 'center' },
  smallChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Space.s + 4, paddingVertical: 6, minHeight: 36, justifyContent: 'center' },
  option: { borderRadius: 14, padding: Space.m, gap: 4 },
  optionHead: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  swatch: { width: 20, height: 20, borderRadius: 10, borderWidth: 1 },
  quote: { borderLeftWidth: 3, paddingLeft: Space.s + 2, gap: 2 },
  step: { flexDirection: 'row', gap: Space.s },
  field: { flexDirection: 'row', gap: Space.s, alignItems: 'flex-start' },
  recapRow: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  logo: { width: '100%', height: 120 },
  input: { minHeight: TapHeight, borderWidth: 1, borderRadius: 12, paddingHorizontal: Space.m, fontSize: 17 },
  multi: { minHeight: 90, paddingTop: 12, textAlignVertical: 'top' },
});
