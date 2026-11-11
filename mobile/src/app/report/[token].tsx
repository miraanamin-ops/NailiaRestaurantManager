// One report (phase 5): the weekly or monthly report as it was saved (never
// recalculated), with charts, the 3 next actions (each starts in Chat), the PDF to
// share, and the full web page.
import * as Sharing from 'expo-sharing';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { BarChart, Change, money } from '@/components/charts';
import { Button, Card, Screen, T, usePalette } from '@/components/ui';
import { Space } from '@/constants/theme';
import { getReport, LoginNeeded, type Compare, type Daily, type MonthlyData, type Report, type ReportAction, type ReportStat, type WeeklyData, type WeeklySection } from '@/lib/api';
import { useSession } from '@/lib/session';

const fmt = (format: ReportStat['format']) => (n: number) => (format === 'money' ? money(n) : format === 'rating' ? n.toFixed(1) : String(Math.round(n)));
const dayLabel = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
const dayNum = (ymd: string) => String(Number(ymd.slice(8, 10)));

export default function ReportScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { restaurantId, signOut } = useSession();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    getReport(restaurantId, token)
      .then(setReport)
      .catch((err) => (err instanceof LoginNeeded ? signOut() : setError("Couldn't open this report. Check your signal and try again.")));
  }, [restaurantId, token, signOut]);

  async function sharePdf() {
    if (!report) return;
    setSharing(true);
    try {
      const { File, Paths } = await import('expo-file-system');
      const file = await File.downloadFileAsync(report.pdfUrl, new File(Paths.cache, `dinerai-report-${report.token.slice(0, 8)}.pdf`), { idempotent: true });
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Share your report' });
    } catch {
      setError('Couldn’t get the PDF just now. Please try again.');
    } finally {
      setSharing(false);
    }
  }

  const title = report ? (report.kind === 'monthly' ? (report.data as MonthlyData).figures.label : (report.data as WeeklyData).period.label) : 'Report';
  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      {error && (
        <Card accent>
          <T>{error}</T>
        </Card>
      )}
      {!report && !error && <ActivityIndicator />}
      {report && (report.kind === 'monthly' ? <Monthly data={report.data as MonthlyData} /> : <Weekly data={report.data as WeeklyData} />)}
      {report && (
        <>
          <Button label="Share the PDF" onPress={sharePdf} busy={sharing} />
          {report.webUrl ? <Button label="Open the full report" kind="plain" onPress={() => WebBrowser.openBrowserAsync(report.webUrl!)} /> : null}
        </>
      )}
    </Screen>
  );
}

function Actions({ actions }: { actions: ReportAction[] }) {
  if (!actions.length) return null;
  return (
    <Card>
      <T kind="heading">Next 3 actions</T>
      {actions.map((a, i) => (
        <View key={i} style={styles.action}>
          <T style={{ fontWeight: '600' }}>
            {i + 1}. {a.title}
          </T>
          {a.why ? (
            <T kind="small" quiet>
              {a.why}
            </T>
          ) : null}
          <Button label="Start in Chat" kind="plain" onPress={() => router.navigate({ pathname: '/chat', params: { prefill: a.message || a.title } })} />
        </View>
      ))}
    </Card>
  );
}

function Stat({ s, against }: { s: ReportStat; against: string }) {
  const f = fmt(s.format);
  return (
    <View style={styles.stat}>
      <T kind="small" quiet>
        {s.label}
      </T>
      <T kind="heading">{f(s.value.now)}</T>
      <Change now={s.value.now} before={s.value.before} format={f} against={against} />
    </View>
  );
}

function Weekly({ data }: { data: WeeklyData }) {
  const against = 'the week before';
  return (
    <>
      {data.simulated ? (
        <T kind="small" quiet>
          {data.simulated}
        </T>
      ) : null}
      {data.sections.map((s) => (
        <WeeklyBlock key={`${s.id}-${String(s.key ?? '')}`} s={s} against={against} />
      ))}
    </>
  );
}

function WeeklyBlock({ s, against }: { s: WeeklySection; against: string }) {
  const c = usePalette();
  const daily = (d: unknown, title: string, format?: (n: number) => string) => {
    const x = d as Daily | undefined;
    return x?.days?.length ? <BarChart title={title} values={x.values} labels={x.days.map(dayLabel)} format={format} /> : null;
  };
  const compare = (label: string, v: unknown, format: (n: number) => string) => {
    const x = v as Compare | null | undefined;
    if (!x) return null;
    return (
      <View style={styles.stat}>
        <T kind="small" quiet>
          {label}
        </T>
        <T kind="heading">{format(x.now)}</T>
        <Change now={x.now} before={x.before} format={format} against={against} />
      </View>
    );
  };
  const list = (title: string, items: unknown) => {
    const xs = (items as (string | { label: string; count: number })[] | undefined) ?? [];
    if (!xs.length) return null;
    return (
      <View style={{ gap: 2 }}>
        <T kind="label" quiet>
          {title}
        </T>
        {xs.map((x, i) => (
          <T key={i} kind="small">
            • {typeof x === 'string' ? x : `${x.label} (${x.count})`}
          </T>
        ))}
      </View>
    );
  };
  const count = (n: number) => String(Math.round(n));
  switch (s.id) {
    case 'headline':
      return (
        <Card accent>
          <T kind="heading">{String(s.sentence ?? '')}</T>
          <View style={styles.stats}>{((s.stats as ReportStat[]) ?? []).map((x) => <Stat key={x.label} s={x} against={against} />)}</View>
        </Card>
      );
    case 'sales': {
      const best = s.best as { day: string; amount: number } | null;
      const worst = s.worst as { day: string; amount: number } | null;
      return (
        <Card>
          <T kind="heading">Sales</T>
          <View style={styles.stats}>
            {compare('Net sales', s.net, money)}
            {compare('Transactions', s.transactions, count)}
          </View>
          {daily(s.daily, 'Net sales by day', money)}
          {best ? <T kind="small">Best day: {dayLabel(best.day)}, {money(best.amount)}</T> : null}
          {worst ? <T kind="small">Quietest day: {dayLabel(worst.day)}, {money(worst.amount)}</T> : null}
          {s.summary ? <T kind="small" quiet>{String(s.summary)}</T> : null}
          {s.dummy ? <T kind="small" quiet>Includes test figures.</T> : null}
        </Card>
      );
    }
    case 'reputation':
      return (
        <Card>
          <T kind="heading">Reputation</T>
          <View style={styles.stats}>
            {compare('Google rating', s.rating, (n) => n.toFixed(1))}
            {compare('Replies posted', s.answered, count)}
          </View>
          {daily(s.daily, 'New reviews by day', count)}
          {list('Praise', s.praise)}
          {list('Complaints', s.complaints)}
        </Card>
      );
    case 'themes':
      return (
        <Card>
          <T kind="heading">What customers said</T>
          {list('Praise', s.praise)}
          {list('Complaints', s.complaints)}
        </Card>
      );
    case 'customers': {
      const campaigns = (s.campaigns as { name: string; sent: number; opened: number; redeemed: number }[]) ?? [];
      return (
        <Card>
          <T kind="heading">Customers and campaigns</T>
          <View style={styles.stats}>
            {compare('Sign-ups', s.signups, count)}
            {compare('Emails opened', s.opens, count)}
            {compare('Offers used', s.redemptions, count)}
          </View>
          {daily(s.daily, 'Sign-ups by day', count)}
          {campaigns.map((x) => (
            <T key={x.name} kind="small">
              {x.name}: {x.sent} sent, {x.opened} opened, {x.redeemed} used
            </T>
          ))}
        </Card>
      );
    }
    case 'google': {
      const ins = s.insights as Record<string, Compare | undefined> | null;
      return (
        <Card>
          <T kind="heading">Google</T>
          <View style={styles.stats}>
            {compare('Posts', s.posts, count)}
            {ins ? compare('Views', ins.views, count) : null}
            {ins ? compare('Calls', ins.calls, count) : null}
            {ins ? compare('Directions', ins.directions, count) : null}
          </View>
        </Card>
      );
    }
    case 'forecast': {
      const days = (s.days as { day: string; low: number; high: number; actual: number; inside: boolean }[]) ?? [];
      return (
        <Card>
          <T kind="heading">How the forecast did</T>
          <T kind="small" quiet>
            {String(s.inside)} of {String(s.total)} days inside the forecast range
          </T>
          {days.map((d) => (
            <T key={d.day} kind="small" style={{ color: d.inside ? c.text : c.textSecondary }}>
              {d.inside ? '✓' : '•'} {dayLabel(d.day)}: {d.actual} (forecast {d.low} to {d.high})
            </T>
          ))}
        </Card>
      );
    }
    case 'feature':
      return (
        <Card>
          <T kind="heading">{String(s.title ?? '')}</T>
          <View style={styles.stats}>{((s.stats as ReportStat[]) ?? []).map((x) => <Stat key={x.label} s={x} against={against} />)}</View>
          {((s.lines as string[]) ?? []).map((l, i) => (
            <T key={i} kind="small">
              {l}
            </T>
          ))}
          {s.footnote ? <T kind="small" quiet>{String(s.footnote)}</T> : null}
        </Card>
      );
    case 'actions':
      return <Actions actions={(s.actions as ReportAction[]) ?? []} />;
    default:
      return null;
  }
}

function Monthly({ data }: { data: MonthlyData }) {
  const f = data.figures;
  const vs = (x: { label: string; net: number; likeForLike: number | null } | null) =>
    x ? (
      <T kind="small" quiet>
        {x.label}: {x.likeForLike !== null ? `${x.likeForLike >= 0 ? '+' : ''}${x.likeForLike}% like for like` : money(x.net)}
      </T>
    ) : null;
  return (
    <>
      <Card accent>
        <T kind="heading">{data.words.headline}</T>
        <T kind="small" quiet>
          {money(f.net)} net over {f.traded} trading days{f.avgOrder ? `, ${money(f.avgOrder)} average order` : ''}
        </T>
        {vs(f.vsLastMonth)}
        {vs(f.vsLastYear)}
      </Card>
      {(data.words.highlights ?? []).length > 0 && (
        <Card>
          <T kind="heading">Key messages</T>
          {data.words.highlights!.map((h) => (
            <View key={h.title} style={{ gap: 2 }}>
              <T style={{ fontWeight: '600' }}>{h.title}</T>
              <T kind="small" quiet>
                {h.detail}
              </T>
            </View>
          ))}
        </Card>
      )}
      <Card>
        <T kind="heading">Takings by day</T>
        <BarChart title="Net takings by day" values={f.daily.map((d) => d.net)} labels={f.daily.map((d) => dayNum(d.day))} format={money} />
      </Card>
      {f.weekdays.length > 0 && (
        <Card>
          <T kind="heading">Your week</T>
          <BarChart title="Average takings by weekday" values={f.weekdays.map((w) => w.avg)} labels={f.weekdays.map((w) => w.weekday)} format={money} />
        </Card>
      )}
      {f.dishes && (
        <Card>
          <T kind="heading">Dishes</T>
          {f.dishes.top.slice(0, 5).map((d, i) => (
            <T key={d.item} kind="small">
              {i + 1}. {d.item}: {money(d.amount)}
            </T>
          ))}
          {f.dishes.rising.length > 0 && <T kind="small" quiet>Rising: {f.dishes.rising.map((d) => d.item).join(', ')}</T>}
          {f.dishes.falling.length > 0 && <T kind="small" quiet>Falling: {f.dishes.falling.map((d) => d.item).join(', ')}</T>}
        </Card>
      )}
      {(f.labour || f.reviews) && (
        <Card>
          {f.labour && (
            <T>
              Staff cost: {money(f.labour.cost)} ({f.labour.pct}% of takings{f.labour.target ? `, target ${f.labour.target}%` : ''})
            </T>
          )}
          {f.reviews && (
            <T>
              Reviews: {f.reviews.count}
              {f.reviews.average ? `, average ${f.reviews.average.toFixed(1)}★` : ''}
            </T>
          )}
        </Card>
      )}
      {data.benchmark && (
        <Card>
          <T kind="heading">How you compare nearby</T>
          <T kind="small" quiet>
            {data.benchmark.restaurants} DinerAI restaurants within {data.benchmark.radiusMiles} mile{data.benchmark.radiusMiles === 1 ? '' : 's'}
          </T>
          {data.benchmark.rows.map((r) => (
            <T key={r.label} kind="small">
              {r.label}: you {r.you}, nearby {r.nearby} ({r.position})
            </T>
          ))}
        </Card>
      )}
      <Actions actions={data.words.actions} />
      {f.missing.map((m) => (
        <T key={m} kind="small" quiet>
          {m}
        </T>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.m },
  stat: { minWidth: 120, flexGrow: 1, gap: 2 },
  action: { gap: 2, paddingTop: Space.xs },
});
