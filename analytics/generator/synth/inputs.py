"""Messy input files for the data-collection features, each with its answer in answers.json.

  pos/        till exports, one file a month for the last 3 months, in the restaurant's POS layout
              (Epos Now style for the South Asian restaurants, Square style for the cafe,
              Lightspeed style for the takeaway). The messy copy adds broken and repeated rows.
  z_reports/  photo-like end-of-day till reports for the last 8 weeks (tilted, uneven light, noise)
  invoices/   photo-like supplier invoices for the last 8 weeks
  rotas/      the last 4 weeks' rotas as CSV and as a photo of the printed sheet
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .timeutil import LONDON

FONTS = Path(__file__).resolve().parent / "fonts"
LAYOUT = {"south_asian": "epos_now", "cafe": "square", "takeaway": "lightspeed"}
CHANNEL_WORDS = {"epos_now": {"dine_in": "Eat In", "takeaway": "Take Away", "delivery": "Delivery"},
                 "square": {"dine_in": "For Here", "takeaway": "To Go", "delivery": "Delivery"},
                 "lightspeed": {"dine_in": "TABLE", "takeaway": "TAKEAWAY", "delivery": "DELIVERY"}}


def _font(size, bold=False, mono=True):
    name = ("DejaVuSansMono" if mono else "DejaVuSans") + ("-Bold" if bold else "") + ".ttf"
    return ImageFont.truetype(str(FONTS / name), size)


def _shop(cfg) -> str:
    """The name printed on paperwork (no "(demo)" or "messy copy")."""
    return cfg["name"].replace(" (demo)", "").replace(", messy copy", "")


def money(p: int) -> str:
    return f"{p / 100:.2f}"


def write_all(sim, staffing, costs, T, folder: Path, seed: int) -> dict:
    import shutil
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    rng = np.random.default_rng([seed, sim.cfg["seed_offset"], 31])
    answers = {"pos": pos_exports(sim, T, folder / "pos", rng), "z_reports": z_reports(sim, T, folder / "z_reports", rng),
               "invoices": invoice_images(sim, costs, folder / "invoices", rng), "rotas": rotas(sim, staffing, folder / "rotas", rng)}
    (folder / "answers.json").write_text(json.dumps(answers, indent=1, sort_keys=True), encoding="utf8", newline="\n")
    return {k: len(v) if isinstance(v, list) else len(v.get("files", [])) for k, v in answers.items()}


# --- POS exports --------------------------------------------------------------
def _till_names(sim, T):
    """The till name each dish had on each day (the messy copy's till was reprogrammed)."""
    from .menus import MESSY_TILL_NAMES
    cfg = sim.cfg
    renamed_from = cfg.get("mess", {}).get("renamed_till_from")

    def name(dish, day: dt.date):
        if renamed_from and day.isoformat() >= renamed_from and dish.till_name in MESSY_TILL_NAMES:
            return MESSY_TILL_NAMES[dish.till_name]
        return dish.till_name
    return name


def pos_exports(sim, T, folder: Path, rng) -> list[dict]:
    folder.mkdir(parents=True)
    cfg, menu = sim.cfg, sim.menu
    layout = LAYOUT[cfg["menu"]]
    words = CHANNEL_WORDS[layout]
    name_on = _till_names(sim, T)
    by_month: dict[str, list] = {}
    for r in sim.results:
        if r.receipts is None or r.closed:
            continue
        by_month.setdefault(r.day.strftime("%Y-%m"), []).append(r)
    files = []
    prefix = cfg["slug"][5:9].upper()
    for month, results in sorted(by_month.items()):
        lines, day_totals = [], {}
        for r in results:
            tot = 0
            for rc in r.receipts:
                t_local = dt.datetime.combine(r.day + dt.timedelta(days=rc["hour"] // 24), dt.time(rc["hour"] % 24, rc["minute"]))
                txn = f"{prefix}{r.day:%y%m%d}{rc['seq']:04d}"
                for di, price, disc in rc["lines"]:
                    dish = menu.dishes[di]
                    lines.append({"day": r.day, "t": t_local, "txn": txn, "item": name_on(dish, r.day), "category": dish.section,
                                  "qty": 1, "price": price, "discount": disc, "total": price - disc, "channel": rc["channel"],
                                  "payment": rc["payment"], "covers": rc["people"] if rc["channel"] == "dine_in" else 0})
                    tot += price - disc
            if r.refunds:
                last = r.receipts[-1]
                t_local = dt.datetime.combine(r.day + dt.timedelta(days=last["hour"] // 24), dt.time(last["hour"] % 24, 59))
                lines.append({"day": r.day, "t": t_local, "txn": f"{prefix}{r.day:%y%m%d}R001", "item": "REFUND", "category": "Refunds",
                              "qty": 1, "price": -r.refunds, "discount": 0, "total": -r.refunds, "channel": "dine_in",
                              "payment": "card", "covers": 0})
                tot -= r.refunds
            day_totals[r.day.isoformat()] = tot
        text, broken, repeated = _render_pos(layout, words, lines, cfg, rng)
        fname = {"epos_now": f"EposNow_TransactionItems_{month}.csv", "square": f"items-{month}-01-{month}-end.csv",
                 "lightspeed": f"receipts_export_{month}.csv"}[layout]
        (folder / fname).write_text(text, encoding="utf8", newline="")
        files.append({"file": f"pos/{fname}", "layout": layout, "month": month, "lines": len(lines),
                      "day_totals_pence": day_totals, "broken_lines": broken, "repeated_lines": repeated,
                      "note": "Totals include VAT and are after discounts. Line numbers count the header as line 1."})
    return files


def _render_pos(layout, words, lines, cfg, rng):
    buf = io.StringIO()
    if layout == "epos_now":
        w = csv.writer(buf, lineterminator="\r\n")
        w.writerow(["Transaction Date", "Transaction Time", "Transaction ID", "Product", "Category", "Quantity", "Unit Price",
                     "Discount", "Total", "Tender Type", "Eat In/Take Away", "Till", "Covers"])
        rows = [[l["day"].strftime("%d/%m/%Y"), l["t"].strftime("%H:%M"), l["txn"], l["item"], l["category"], l["qty"], money(l["price"]),
                 money(l["discount"]), money(l["total"]), l["payment"].title(), words[l["channel"]], "Till 1", l["covers"] or ""] for l in lines]
    elif layout == "square":
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(["Date", "Time", "Time Zone", "Category", "Item", "Qty", "Price Point Name", "Gross Sales", "Discounts", "Net Sales",
                     "Tax", "Transaction ID", "Dining Option", "Payment Method"])
        rows = []
        for l in lines:
            net = l["total"]
            tax = net - round(net / 1.2)
            rows.append([l["day"].isoformat(), l["t"].strftime("%H:%M:%S"), "Europe/London", l["category"], l["item"], l["qty"], "Regular",
                         f"£{money(l['price'])}", f"-£{money(l['discount'])}" if l["discount"] else "£0.00", f"£{money(net)}",
                         f"£{money(tax)}", l["txn"], words[l["channel"]], l["payment"].title()])
    else:
        w = csv.writer(buf, delimiter=";", lineterminator="\n")
        w.writerow(["receipt_id", "created_at", "product_name", "quantity", "unit_price", "discount_amount", "total_incl_vat",
                     "vat_rate", "payment_type", "order_type", "covers"])
        rows = [[l["txn"], l["t"].replace(tzinfo=LONDON).isoformat(timespec="seconds"), l["item"], l["qty"], money(l["price"]),
                 money(l["discount"]), money(l["total"]), "20", l["payment"].upper().replace(" ", "_"), words[l["channel"]], l["covers"]] for l in lines]
    broken, repeated = [], []
    mess = cfg.get("mess")
    out_rows = list(rows)
    if mess:
        # Repeated rows (an export run twice over the same minutes) and broken rows.
        for _ in range(mess["duplicate_rows_per_file"]):
            k = int(rng.integers(0, len(out_rows)))
            out_rows.insert(k + 1, list(out_rows[k]))
        for _ in range(mess["malformed_rows_per_file"]):
            k = int(rng.integers(1, len(out_rows)))
            row = list(out_rows[k])
            kind = int(rng.integers(0, 3))
            if kind == 0:
                row = row[: len(row) // 2]                     # cut short
            elif kind == 1:
                row[8 if layout == "epos_now" else 9 if layout == "square" else 6] = "#VALUE!"  # spreadsheet error in the total
            else:
                row[0] = ""                                    # date missing
            out_rows[k] = row
    for r in out_rows:
        w.writerow(r)
    if mess:
        # Find them by line number afterwards (header = line 1).
        seen = set()
        for i, r in enumerate(out_rows, start=2):
            key = tuple(map(str, r))
            if key in seen:
                repeated.append(i)
            seen.add(key)
            if len(r) < len(rows[0]) or "#VALUE!" in r or r[0] == "":
                broken.append(i)
    return buf.getvalue(), broken, repeated


# --- photo effects ------------------------------------------------------------
def photo(img: Image.Image, rng, bg=(70, 62, 55)) -> Image.Image:
    """Make a clean render look like a phone photo: on a table, tilted, uneven light, soft, noisy."""
    w, h = img.size
    pad = int(0.08 * max(w, h))
    angle = float(rng.uniform(-4, 4))
    img = img.convert("RGB")
    rot = img.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=bg)
    canvas = Image.new("RGB", (rot.width + 2 * pad, rot.height + 2 * pad), bg)
    canvas.paste(rot, (pad + int(rng.integers(-pad // 3, pad // 3)), pad + int(rng.integers(-pad // 3, pad // 3))))
    # A slight perspective: the top a little narrower than the bottom.
    cw, ch = canvas.size
    k = float(rng.uniform(0.01, 0.04)) * cw
    coeffs = _persp([(k, 0), (cw - k, 0), (cw, ch), (0, ch)], [(0, 0), (cw, 0), (cw, ch), (0, ch)])
    canvas = canvas.transform((cw, ch), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=bg)
    a = np.asarray(canvas).astype(np.float32)
    yy, xx = np.mgrid[0:ch, 0:cw]
    cx, cy = rng.uniform(0.2, 0.8) * cw, rng.uniform(0.2, 0.8) * ch
    light = 0.78 + 0.25 * np.exp(-(((xx - cx) / cw) ** 2 + ((yy - cy) / ch) ** 2) * 2.5)
    a = a * light[..., None] + rng.normal(0, 6, a.shape)
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(float(rng.uniform(0.4, 1.0))))
    return out.resize((int(cw * 0.75), int(ch * 0.75)), Image.LANCZOS)


def _persp(src, dst):
    m = []
    for (x, y), (u, v) in zip(dst, src):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    A = np.array(m, dtype=float)
    B = np.array(src, dtype=float).reshape(8)
    return list(np.linalg.solve(A, B))


# --- Z reports ------------------------------------------------------------------
def z_reports(sim, T, folder: Path, rng) -> list[dict]:
    folder.mkdir(parents=True)
    cfg = sim.cfg
    days_rows = {r["day"]: r for r in T["sales_days"]}
    out = []
    since = sim.end - dt.timedelta(days=55)
    znum = 4000 + int(rng.integers(0, 900))
    for r in sim.results:
        if r.day < since or r.closed or not r.orders:
            continue
        znum += 1
        f = _font(22)
        fb = _font(26, bold=True)
        lines = [(_shop(cfg).upper(), fb), (cfg["address"].replace(" (demo)", ""), f), ("", f),
                 ("*** Z REPORT ***", fb), (f"Z No: {znum}", f), (f"Date: {r.day:%d/%m/%Y}", f),
                 (f"Printed: {(r.day + dt.timedelta(days=1)):%d/%m/%Y} 0{int(rng.integers(0, 2))}:{int(rng.integers(10, 59))}", f), ("-" * 30, f)]
        net = round(r.gross / 1.2)
        kv = [("GROSS SALES", money(r.gross + r.discounts + r.refunds)), ("DISCOUNTS", "-" + money(r.discounts)),
              ("REFUNDS", "-" + money(r.refunds)), ("NET SALES", money(r.gross)), ("  of which VAT 20%", money(r.gross - net)),
              ("  ex VAT", money(net)), ("-" * 30, None), ("CASH", money(r.cash)), ("CARD", money(r.card)),
              ("-" * 30, None), ("TRANSACTIONS", str(r.orders)), ("COVERS", str(r.covers)), ("AVG SPEND", money(r.gross // max(1, r.orders)))]
        for k, v in kv:
            lines.append((k if v is None else f"{k:<20}{v:>10}", f))
        lines.append(("-" * 30, f))
        lines.append(("HOURLY SALES", fb))
        for h, (s, o, c) in sorted(r.hours.items()):
            lines.append((f"{h % 24:02d}:00  {o:>4}  {money(s):>12}", f))
        lines.append(("", f))
        lines.append(("END OF REPORT", f))
        width = 520
        height = 30 + sum(34 for _ in lines) + 30
        img = Image.new("RGB", (width, height), (250, 248, 240))
        dr = ImageDraw.Draw(img)
        y = 20
        for text, font in lines:
            tw = dr.textlength(text, font=font)
            x = (width - tw) / 2 if font is fb or text.startswith("***") else 24
            dr.text((x, y), text, fill=(30, 30, 30), font=font)
            y += 34
        name = f"z_{r.day.isoformat()}.jpg"
        photo(img, rng).save(folder / name, quality=72)
        out.append({"file": f"z_reports/{name}", "business_date": r.day.isoformat(), "z_number": znum,
                    "gross_before_discounts_pence": r.gross + r.discounts + r.refunds, "discounts_pence": r.discounts,
                    "refunds_pence": r.refunds, "net_sales_incl_vat_pence": r.gross, "vat_pence": r.gross - net,
                    "cash_pence": r.cash, "card_pence": r.card, "transactions": r.orders, "covers": r.covers,
                    "hourly": [{"hour": h % 24, "orders": o, "sales_pence": s} for h, (s, o, c) in sorted(r.hours.items())],
                    "in_database": r.day.isoformat() in days_rows})
    return out


# --- invoices -------------------------------------------------------------------
def invoice_images(sim, costs, folder: Path, rng) -> list[dict]:
    folder.mkdir(parents=True)
    since = sim.end - dt.timedelta(days=55)
    lines_by = {}
    for ln in costs.lines:
        lines_by.setdefault(ln["invoice"], []).append(ln)
    out = []
    for inv in costs.invoices:
        if inv["date"] < since:
            continue
        sname = sim.menu.suppliers[inv["supplier"]][0].replace(" (demo)", "")
        f, fb, fs = _font(20, mono=False), _font(28, bold=True, mono=False), _font(17, mono=False)
        W = 1000
        rows = lines_by[inv["id"]]
        H = 520 + 38 * len(rows) + 260
        img = Image.new("RGB", (W, H), (252, 252, 250))
        dr = ImageDraw.Draw(img)
        dr.text((50, 40), sname, font=fb, fill=(20, 40, 90))
        dr.text((50, 85), "Unit 4, Lea Valley Trading Estate, London E10", font=fs, fill=(60, 60, 60))
        dr.text((50, 108), "VAT No GB 123 4567 89", font=fs, fill=(60, 60, 60))
        dr.text((W - 330, 40), "INVOICE", font=fb, fill=(20, 20, 20))
        dr.text((W - 330, 90), f"No: {inv['number']}", font=f, fill=(20, 20, 20))
        dr.text((W - 330, 120), f"Date: {inv['date']:%d/%m/%Y}", font=f, fill=(20, 20, 20))
        dr.text((50, 150), "Deliver to:", font=fs, fill=(60, 60, 60))
        dr.text((50, 175), _shop(sim.cfg), font=f, fill=(20, 20, 20))
        dr.text((50, 205), sim.cfg["address"].replace(" (demo)", ""), font=fs, fill=(40, 40, 40))
        y = 280
        dr.rectangle([40, y, W - 40, y + 40], fill=(230, 233, 240))
        for x, t in ((50, "Description"), (560, "Qty"), (640, "Unit price"), (790, "VAT"), (870, "Amount")):
            dr.text((x, y + 9), t, font=fs, fill=(20, 20, 20))
        y += 50
        for ln in rows:
            unit = ln["net"] // max(1, ln["quantity"])
            dr.text((50, y), ln["description"], font=f, fill=(20, 20, 20))
            dr.text((560, y), f"{ln['quantity']:g}", font=f, fill=(20, 20, 20))
            dr.text((640, y), f"£{money(unit)}", font=f, fill=(20, 20, 20))
            dr.text((790, y), "20%" if ln["vat"] else "0%", font=f, fill=(20, 20, 20))
            dr.text((870, y), f"£{money(ln['net'])}", font=f, fill=(20, 20, 20))
            y += 38
        dr.line([40, y + 10, W - 40, y + 10], fill=(120, 120, 120), width=2)
        y += 30
        for label, val in (("Net", inv["net"]), ("VAT", inv["vat"]), ("Total due", inv["gross"])):
            dr.text((640, y), label, font=fb if label == "Total due" else f, fill=(20, 20, 20))
            dr.text((850, y), f"£{money(val)}", font=fb if label == "Total due" else f, fill=(20, 20, 20))
            y += 40
        dr.text((50, H - 70), "Payment terms: 14 days. Thank you for your business.", font=fs, fill=(80, 80, 80))
        name = f"invoice_{inv['date'].isoformat()}_{inv['number']}.jpg"
        photo(img, rng).save(folder / name, quality=72)
        out.append({"file": f"invoices/{name}", "invoice_id": inv["id"], "supplier": sname, "number": inv["number"],
                    "date": inv["date"].isoformat(), "net_pence": inv["net"], "vat_pence": inv["vat"], "gross_pence": inv["gross"],
                    "lines": [{"description": ln["description"], "quantity": ln["quantity"], "line_net_pence": ln["net"],
                               "vat_pence": ln["vat"], "ingredient": ln["ingredient"], "quantity_std": ln["quantity_std"]} for ln in rows]})
    return out


# --- rotas ----------------------------------------------------------------------
def rotas(sim, staffing, folder: Path, rng) -> list[dict]:
    folder.mkdir(parents=True)
    names = {s["id"]: s["name"] for s in staffing.staff}
    weeks = [w for w in staffing.weeks if w + dt.timedelta(days=6) <= sim.end][-4:]
    out = []
    for w in weeks:
        days = [w + dt.timedelta(days=i) for i in range(7)]
        grid: dict[str, dict[dt.date, str]] = {}
        for sh in staffing.shifts:
            if sh["day"] in days:
                who = names.get(sh["staff"], "OPEN SHIFT")
                s, e = sh["start"].astimezone(LONDON), sh["end"].astimezone(LONDON)
                cell = f"{s:%H:%M}-{e:%H:%M}" + ("" if who != "OPEN SHIFT" else f" ({sh['role']})")
                key = who if who != "OPEN SHIFT" else f"OPEN SHIFT {sh['role']}"
                grid.setdefault(key, {})
                grid[key][sh["day"]] = (grid[key].get(sh["day"], "") + " / " + cell).strip(" /")
        header = ["Name"] + [d.strftime("%a %d %b") for d in days] + ["Hours"]
        csv_rows = []
        for who in sorted(grid):
            hrs = 0.0
            for d in days:
                for part in grid[who].get(d, "").split(" / "):
                    if part and "-" in part:
                        a, b = part.split(" ")[0].split("-")
                        ha, hb = int(a[:2]) + int(a[3:]) / 60, int(b[:2]) + int(b[3:]) / 60
                        hrs += (hb - ha) % 24
            csv_rows.append([who] + [grid[who].get(d, "OFF") for d in days] + [f"{hrs:.1f}"])
        cname = f"rota_week_{w.isoformat()}.csv"
        with open(folder / cname, "w", encoding="utf8", newline="") as fh:
            c = csv.writer(fh)
            c.writerow([f"{_shop(sim.cfg)} rota, week starting {w:%d %B %Y}"])
            c.writerow(header)
            c.writerows(csv_rows)
        # The printed sheet, photographed.
        f, fb = _font(17, mono=False), _font(19, bold=True, mono=False)
        cw = [170] + [180] * 7 + [80]
        W = sum(cw) + 40
        H = 120 + 44 * (len(csv_rows) + 1) + 40
        img = Image.new("RGB", (W, H), (253, 253, 251))
        dr = ImageDraw.Draw(img)
        dr.text((20, 25), f"ROTA  w/c {w:%d/%m/%Y}", font=_font(30, bold=True, mono=False), fill=(20, 20, 20))
        y = 90
        for row_i, row in enumerate([header] + csv_rows):
            x = 20
            for j, cell in enumerate(row):
                dr.rectangle([x, y, x + cw[j], y + 44], outline=(90, 90, 90), width=1, fill=(232, 236, 244) if row_i == 0 else None)
                text = cell if len(cell) <= 22 else cell[:21] + ".."
                dr.text((x + 6, y + 12), text, font=fb if row_i == 0 or j == 0 else f, fill=(20, 20, 20))
                x += cw[j]
            y += 44
        pname = f"rota_week_{w.isoformat()}.jpg"
        photo(img, rng, bg=(120, 110, 95)).save(folder / pname, quality=72)
        out.append({"csv": f"rotas/{cname}", "photo": f"rotas/{pname}", "week_start": w.isoformat(),
                    "shifts": [{"staff": names.get(sh["staff"]), "role": sh["role"], "day": sh["day"].isoformat(),
                                "starts_at": sh["start"].isoformat(), "ends_at": sh["end"].isoformat(), "break_minutes": sh["break"]}
                               for sh in staffing.shifts if sh["day"] in days]})
    return out
