// Reports > Rota: this week's or next week's rota as the owner sees it (who works
// when, hours, cost and labour % against the target), whether it's approved or
// waiting in the Inbox, and the team's link to share (no pay or costs on it).
// Each day opens to show its shifts; today's is open to begin with. Changes are made
// in words in Chat ("Ali can't do Friday"), as on WhatsApp.
import { router } from 'expo-router';
import { useState } from 'react';
import { LayoutAnimation, Pressable, Share, StyleSheet, View } from 'react-native';

import { money } from '@/components/charts';
import { Avatar, Button, Card, Icon, Panel, Pill, T, usePalette } from '@/components/ui';
import { Space } from '@/constants/theme';
import type { AppRotaDay, AppRotaWeek } from '@/lib/api';

export function RotaWeek({ week, next, today }: { week: AppRotaWeek; next: boolean; today?: string }) {
  const c = usePalette();
  const [open, setOpen] = useState<string | null>(today && week.days.some((d) => d.date === today) ? today : null);
  if (week.status === 'none') {
    return (
      <Card>
        <Icon name="calendar-outline" size={28} color={c.textSecondary} />
        <T kind="heading">{next ? 'Next week’s rota isn’t ready yet' : 'No rota this week'}</T>
        <T quiet>
          {next ? 'Every Thursday morning I suggest next week’s rota from your team, their hours and the forecast. It arrives in your Inbox to approve.' : 'There’s no rota saved for this week.'}
        </T>
        <Button
          label="Ask in Chat"
          kind="plain"
          icon="chatbubble-ellipses-outline"
          onPress={() => router.navigate({ pathname: '/chat', params: { prefill: next ? 'Can you suggest next week’s rota?' : 'Show me this week’s rota' } })}
        />
      </Card>
    );
  }
  const t = week.totals;
  const toggle = (date: string) => {
    LayoutAnimation.easeInEaseOut();
    setOpen((x) => (x === date ? null : date));
  };
  return (
    <>
      <Card accent={week.status === 'waiting'}>
        <T kind="heading">{week.label}</T>
        <Pill label={week.status === 'approved' ? 'Approved' : 'Suggested · waiting for you'} tone={week.status === 'approved' ? 'signal' : 'amber'} dot />
        {week.status === 'waiting' ? (
          <>
            <T kind="small" quiet>
              Approve it in your Inbox, or tell me what to change in Chat, like “Ali can’t do Friday”.
            </T>
            <Button label="Review in Inbox" icon="arrow-forward" onPress={() => router.navigate('/inbox')} />
          </>
        ) : week.shareUrl ? (
          <>
            <Button label="Share rota with team" icon="share-outline" onPress={() => Share.share({ message: `This week's rota: ${week.shareUrl}`, url: week.shareUrl! })} />
            <View style={styles.row}>
              <Icon name="lock-closed-outline" size={14} color={c.textSecondary} />
              <T kind="caption" quiet style={{ flex: 1 }}>
                Your team’s link never shows pay, rates or costs.
              </T>
            </View>
          </>
        ) : null}
      </Card>

      {week.openShifts > 0 && (
        <Card tone="ember">
          <View style={styles.row}>
            <Icon name="alert-circle" size={18} color={c.ember} />
            <T kind="label" style={{ color: c.ember }}>
              {week.openShifts} open {week.openShifts === 1 ? 'shift' : 'shifts'}
            </T>
          </View>
          {week.flags.slice(0, 2).map((f) => (
            <T key={f} kind="small">
              {f}
            </T>
          ))}
          <Button label="Sort it in Chat" kind="plain" small icon="chatbubble-ellipses-outline" onPress={() => router.navigate('/chat')} />
        </Card>
      )}

      {t && (
        <Card>
          <T kind="label" quiet>
            The week in numbers
          </T>
          <View style={styles.grid}>
            <Fig label="Total hours" value={`${t.hours}`} unit="hrs" />
            <Fig label="Staff cost" value={money(t.costPence / 100)} />
            {t.labourPct !== null && <Fig label="Of forecast sales" value={`${Math.round(t.labourPct)}%`} warn={t.overTarget} sub={t.target !== null ? `Target ${t.target}%` : undefined} />}
          </View>
          {t.labourPct !== null && t.target !== null && <TargetBar pct={t.labourPct} target={t.target} />}
          {week.openShifts === 0 &&
            week.flags.map((f) => (
              <View key={f} style={styles.row}>
                <Icon name="information-circle-outline" size={15} color={c.amber} />
                <T kind="small" style={{ flex: 1 }}>
                  {f}
                </T>
              </View>
            ))}
        </Card>
      )}

      <T kind="label" quiet style={{ marginTop: Space.s }}>
        Day by day
      </T>
      {week.days.map((d) => (
        <Day key={d.date} day={d} today={d.date === today} open={open === d.date} onToggle={() => toggle(d.date)} />
      ))}
      <Button label="Change something in Chat" kind="plain" icon="chatbubble-ellipses-outline" onPress={() => router.navigate('/chat')} />
    </>
  );
}

function Day({ day, today, open, onToggle }: { day: AppRotaDay; today: boolean; open: boolean; onToggle: () => void }) {
  const c = usePalette();
  const gaps = day.shifts.filter((s) => !s.name).length;
  const [weekday, ...rest] = day.label.split(' ');
  return (
    <View style={[styles.day, { backgroundColor: c.card, borderColor: gaps ? c.ember : c.border }]}>
      <Pressable onPress={onToggle} disabled={day.closed} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${day.label}, ${day.closed ? 'closed' : `${day.shifts.length} shifts`}`} style={styles.dayHead}>
        <View style={[styles.dot, { backgroundColor: day.closed ? c.border : gaps ? c.ember : today ? c.tint : c.textSecondary }]} />
        <View style={{ flex: 1 }}>
          <View style={styles.row}>
            <T style={{ fontWeight: '600' }}>{weekday}</T>
            <T kind="small" quiet>
              {rest.join(' ')}
            </T>
            {today && <Pill label="Today" tone="signal" />}
          </View>
          <T kind="mono" quiet>
            {day.closed ? 'Closed' : `${day.shifts.length} ${day.shifts.length === 1 ? 'shift' : 'shifts'}${gaps ? ` · ${gaps} open` : ''}`}
          </T>
        </View>
        {!day.closed && day.costPence > 0 && (
          <T kind="mono" quiet>
            {money(day.costPence / 100)} · {day.hours}h
          </T>
        )}
        {!day.closed && <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textSecondary} />}
      </Pressable>
      {open && !day.closed && (
        <View style={{ gap: Space.s }}>
          {day.shifts.length === 0 && (
            <T kind="small" quiet>
              Nobody on.
            </T>
          )}
          {day.shifts.map((s, i) => (
            <Panel key={i} style={[styles.shift, !s.name && { backgroundColor: c.emberSoft, borderColor: c.ember }]}>
              <Avatar name={s.name} tone={s.name ? 'neutral' : 'ember'} size={36} />
              <View style={{ flex: 1 }}>
                <T style={[{ fontWeight: '600' }, !s.name && { color: c.ember }]}>{s.name ?? 'Open shift'}</T>
                <T kind="mono" quiet>
                  {s.role} · {s.time}
                </T>
              </View>
              {!s.name && <Pill label="Vacant" tone="ember" />}
            </Panel>
          ))}
        </View>
      )}
    </View>
  );
}

function Fig({ label, value, unit, warn, sub }: { label: string; value: string; unit?: string; warn?: boolean; sub?: string }) {
  const c = usePalette();
  return (
    <Panel style={styles.fig}>
      <T kind="caption" quiet>
        {label}
      </T>
      <T kind="metric" style={{ fontSize: 28, lineHeight: 32, color: warn ? c.ember : c.text }}>
        {value}
        {unit ? (
          <T kind="small" quiet>
            {' '}
            {unit}
          </T>
        ) : null}
      </T>
      {sub ? (
        <T kind="mono" style={{ color: warn ? c.ember : c.textSecondary }}>
          {sub}
        </T>
      ) : null}
    </Panel>
  );
}

// Staff cost as a % of forecast sales against the target: a bar with the target marked.
function TargetBar({ pct, target }: { pct: number; target: number }) {
  const c = usePalette();
  const scale = Math.max(pct, target) * 1.25;
  const over = pct > target;
  return (
    <View style={{ gap: 6 }} accessible accessibilityLabel={`Staff cost ${Math.round(pct)}% of forecast sales, target ${target}%`}>
      <View style={[styles.track, { backgroundColor: c.panel }]}>
        <View style={[styles.fill, { width: `${Math.min(100, (pct / scale) * 100)}%`, backgroundColor: over ? c.ember : c.tint }]} />
        <View style={[styles.marker, { left: `${(target / scale) * 100}%`, backgroundColor: c.text }]} />
      </View>
      <T kind="mono" style={{ color: over ? c.ember : c.textSecondary }}>
        {over ? `${(pct - target).toFixed(1)} points over your ${target}% target` : `Within your ${target}% target`}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s },
  fig: { flexGrow: 1, minWidth: 130, gap: 2 },
  day: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: Space.m - 2, gap: Space.s + 2 },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: Space.s + 2, minHeight: 40 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  shift: { flexDirection: 'row', alignItems: 'center', gap: Space.m - 4, padding: Space.s + 2 },
  track: { height: 10, borderRadius: 5, overflow: 'visible' },
  fill: { height: 10, borderRadius: 5 },
  marker: { position: 'absolute', top: -4, width: 2, height: 18, borderRadius: 1 },
});
