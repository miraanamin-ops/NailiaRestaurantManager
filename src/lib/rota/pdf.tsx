import "server-only";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { noEmDash } from "@/lib/text";
import type { RotaView } from "./view";

// The published rota as an A4 landscape PDF to print or forward: one row per
// person, one column per day (for the team), then on its own page the week hour
// by hour, kitchen and front of house in their own colours (for the owner).
// The built-in PDF font (Helvetica) has no emoji, so text is cleaned first.

const INK = "#1c1917";
const SOFT = "#57534e";
const LINE = "#e7e5e4";
const OPEN = "#b45309";
// Kitchen and front of house in two colours that still print apart in black and white.
const GROUP_COLOURS: Record<string, string> = { kitchen: "#0f766e", front: "#3730a3" };
const groupColour = (key: string) => GROUP_COLOURS[key] ?? SOFT;

const s = StyleSheet.create({
  page: { padding: 28, fontFamily: "Helvetica", fontSize: 9, color: INK },
  head: { marginBottom: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 10, color: SOFT, marginTop: 2 },
  accent: { width: 28, height: 3, borderRadius: 2, marginBottom: 6 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, minHeight: 20, alignItems: "center" },
  headRow: { flexDirection: "row", borderBottomWidth: 1.5, borderBottomColor: INK, minHeight: 18, alignItems: "center" },
  name: { width: 120, paddingRight: 4, fontFamily: "Helvetica-Bold" },
  cell: { flex: 1, paddingHorizontal: 3 },
  hours: { width: 40, textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },
  hourRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, minHeight: 22 },
  hour: { width: 40, paddingTop: 3 },
  slot: { flex: 1, paddingHorizontal: 3, paddingVertical: 3, borderLeftWidth: 1, borderLeftColor: LINE, fontSize: 7.5 },
  names: { flexDirection: "row", flexWrap: "wrap" },
  closedSlot: { backgroundColor: "#f5f5f4" },
  key: { flexDirection: "row", gap: 10 },
  keyItem: { flexDirection: "row", alignItems: "center", gap: 3, fontFamily: "Helvetica-Bold", fontSize: 8 },
  swatch: { width: 7, height: 7, borderRadius: 1 },
  muted: { color: SOFT, fontSize: 8, fontFamily: "Helvetica" },
  open: { color: OPEN },
  foot: { position: "absolute", bottom: 16, left: 28, right: 28, fontSize: 7, color: SOFT },
});

const clean = (t: string) => noEmDash(t).replace(/[^\x20-\x7E£–\n]/g, "").trim();

function RotaPdf({ view, brand }: { view: RotaView; brand: string }) {
  return (
    <Document title={clean(`${view.title} rota ${view.week}`)}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.head}>
          <View>
            <View style={[s.accent, { backgroundColor: brand }]} />
            <Text style={s.title}>{clean(view.title)}</Text>
            <Text style={s.sub}>Rota · {clean(view.week)}</Text>
          </View>
          {view.openShifts ? <Text style={s.open}>{view.openShifts} open shift{view.openShifts === 1 ? "" : "s"} still to fill</Text> : null}
        </View>
        <View style={s.headRow}>
          <Text style={[s.name]}>Name</Text>
          {view.dayHeads.map((d) => (
            <Text key={d} style={[s.cell, s.bold]}>
              {d}
            </Text>
          ))}
          <Text style={[s.hours, s.bold]}>Hours</Text>
        </View>
        {view.people.map((p) => (
          <View key={p.name} style={s.row} wrap={false}>
            <Text style={s.name}>{clean(p.name)}</Text>
            {p.cells.map((c, i) => (
              <Text key={i} style={s.cell}>
                {c || "-"}
              </Text>
            ))}
            <Text style={s.hours}>{p.hours}</Text>
          </View>
        ))}
        {view.hours.length ? (
          <View break>
            <View style={s.head}>
              <View>
                <View style={[s.accent, { backgroundColor: brand }]} />
                <Text style={s.title}>Who&apos;s on, hour by hour</Text>
                <Text style={s.sub}>
                  {clean(view.title)} · {clean(view.week)}
                </Text>
              </View>
              <View style={s.key}>
                {view.groups.map((g) => (
                  <View key={g.key} style={s.keyItem}>
                    <View style={[s.swatch, { backgroundColor: groupColour(g.key) }]} />
                    <Text style={{ color: groupColour(g.key) }}>{clean(g.label)}</Text>
                  </View>
                ))}
                {view.openShifts ? (
                  <View style={s.keyItem}>
                    <View style={[s.swatch, { backgroundColor: OPEN }]} />
                    <Text style={s.open}>Open shift</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View style={s.headRow}>
              <Text style={[s.hour, s.bold]}>Time</Text>
              {view.dayHeads.map((d, i) => (
                <Text key={d} style={[s.slot, s.bold]}>
                  {d}
                  {view.closed[i] ? <Text style={s.muted}> closed</Text> : null}
                </Text>
              ))}
            </View>
            {view.hours.map((h) => (
              <View key={h.label} style={s.hourRow} wrap={false}>
                <Text style={[s.hour, s.bold]}>{h.label}</Text>
                {h.cells.map((groups, i) => (
                  <View key={i} style={view.closed[i] ? [s.slot, s.closedSlot] : s.slot}>
                    {groups.map((g) => (
                      // one block per name, so a line only ever breaks between names
                      <View key={g.key} style={s.names}>
                        {g.names.map((n, j) => (
                          <Text key={j} style={n.open ? s.open : { color: groupColour(g.key) }}>
                            {clean(n.text)}
                            {j < g.names.length - 1 ? ", " : ""}
                          </Text>
                        ))}
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ))}
            <Text style={[s.muted, { marginTop: 6 }]}>
              Each hour lists everyone working any part of it. &quot;From&quot; and &quot;until&quot; mark someone who starts or finishes partway through the hour.
            </Text>
          </View>
        ) : null}
        <Text style={s.foot} fixed>
          Made with DinerAI. Ask your manager about any changes.
        </Text>
      </Page>
    </Document>
  );
}

export function renderRotaPdf(view: RotaView, brand: string) {
  return renderToBuffer(<RotaPdf view={view} brand={brand} />);
}
