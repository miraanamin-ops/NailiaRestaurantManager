// Reports > Rota: this week's or next week's rota as the owner sees it (who works
// when, hours, cost and labour % against the target), whether it's approved or
// waiting in the Inbox, and the team's link to share (no pay or costs on it).
// Changes are made in words in Chat ("Ali can't do Friday"), as on WhatsApp.
import { router } from 'expo-router';
import { Share, StyleSheet, View } from 'react-native';

import { money } from '@/components/charts';
import { Button, Card, T, usePalette } from '@/components/ui';
import { Brand, Space } from '@/constants/theme';
import type { AppRotaWeek } from '@/lib/api';

export function RotaWeek({ week, next }: { week: AppRotaWeek; next: boolean }) {
  const c = usePalette();
  if (week.status === 'none') {
    return (
      <Card>
        <T kind="heading">{next ? 'Next week’s rota isn’t ready yet' : 'No rota this week'}</T>
        <T quiet>
          {next ? 'Every Thursday morning I suggest next week’s rota from your team, their hours and the forecast. It arrives in your Inbox to approve.' : 'There’s no rota saved for this week.'}
        </T>
        <Button label="Ask in Chat" kind="plain" onPress={() => router.navigate({ pathname: '/chat', params: { prefill: next ? 'Can you suggest next week’s rota?' : 'Show me this week’s rota' } })} />
      </Card>
    );
  }
  const t = week.totals;
  return (
    <>
      {week.status === 'waiting' ? (
        <Card accent>
          <T kind="heading">Suggested, waiting for you</T>
          <T quiet>Approve it in your Inbox, or tell me what to change in Chat, like “Ali can’t do Friday”.</T>
          <Button label="Review in Inbox" onPress={() => router.navigate('/inbox')} />
        </Card>
      ) : (
        <Card>
          <T kind="heading">Approved ✓</T>
          <T quiet>Your team can see it on the shared link (no pay or costs on it).</T>
          {week.shareUrl ? <Button label="Share with your team" onPress={() => Share.share({ message: `This week's rota: ${week.shareUrl}`, url: week.shareUrl! })} /> : null}
        </Card>
      )}

      {t && (
        <Card>
          <View style={styles.totals}>
            <Fig label="Hours" value={String(t.hours)} />
            <Fig label="Staff cost" value={money(t.costPence / 100)} />
            {t.labourPct !== null && <Fig label="Of forecast sales" value={`${Math.round(t.labourPct)}%`} warn={t.overTarget} />}
          </View>
          {t.target !== null && (
            <T kind="small" style={{ color: t.overTarget ? Brand.ember : c.textSecondary }}>
              {t.overTarget ? `Above your ${t.target}% target` : `Within your ${t.target}% target`}
            </T>
          )}
          {week.flags.map((f) => (
            <T key={f} kind="small" style={{ color: Brand.ember }}>
              ! {f}
            </T>
          ))}
        </Card>
      )}

      {week.days.map((d) => (
        <Card key={d.date}>
          <View style={styles.dayHead}>
            <T style={{ fontWeight: '700', flex: 1 }}>{d.label}</T>
            {!d.closed && d.costPence > 0 && (
              <T kind="small" quiet>
                {d.hours}h · {money(d.costPence / 100)}
              </T>
            )}
          </View>
          {d.closed ? (
            <T kind="small" quiet>
              Closed
            </T>
          ) : d.shifts.length ? (
            d.shifts.map((s, i) => (
              <View key={i} style={styles.shift}>
                <T style={[{ flex: 1 }, !s.name && { color: Brand.ember }]}>{s.name ?? 'Open shift'}</T>
                <T kind="small" quiet style={{ textAlign: 'right' }}>
                  {s.time}
                  {'\n'}
                  {s.role}
                </T>
              </View>
            ))
          ) : (
            <T kind="small" quiet>
              Nobody on
            </T>
          )}
        </Card>
      ))}
      <Button label="Change something in Chat" kind="plain" onPress={() => router.navigate('/chat')} />
    </>
  );
}

function Fig({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.fig}>
      <T kind="small" quiet>
        {label}
      </T>
      <T kind="heading" style={warn ? { color: Brand.ember } : undefined}>
        {value}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  totals: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.m },
  fig: { minWidth: 90, flexGrow: 1, gap: 2 },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
  shift: { flexDirection: 'row', alignItems: 'center', gap: Space.s, paddingVertical: 4 },
});
