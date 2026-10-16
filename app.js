"use strict";

/* ---------- settings ---------- */

const STORE_KEY = "ca-offer-dashboard-v1";
const DAY = 864e5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const FIELDS = [
  { k: "netSales", short: "Sales", label: "Net Sales (after discounts and returns)" },
  { k: "orders", short: "Orders", label: "Orders" },
  { k: "newCustomers", short: "New Cust.", label: "New Customers (first-time buyers)" },
  { k: "sessions", short: "Sessions", label: "Sessions (store visits)" },
  { k: "adSpend", short: "Ad Spend", label: "Ad Spend (all platforms)" },
  { k: "adRevenue", short: "Ad Rev.", label: "Revenue From Ads (as your ad platform reports it)" },
  { k: "productCosts", short: "COGS", label: "Product Costs (what you paid suppliers)" },
  { k: "shipping", short: "Shipping", label: "Shipping And Fulfilment" },
  { k: "paymentFees", short: "Pay. Fees", label: "Payment Fees" },
  { k: "otherCosts", short: "Other", label: "Other Variable Costs (packaging, per-order apps)" },
  { k: "repeatRate", short: "Repeat 90d", label: "Repeat Orders Per New Customer Within 90 Days (e.g. 0.4)" }
];
const KEYS = FIELDS.map(f => f.k);

const LANES = [
  { k: "cp", label: "Contribution profit", fmt: "money0", flag: m => m.cp < 0 },
  { k: "cm", label: "Contribution margin", fmt: "pct1", flag: m => m.cm < 0 },
  { k: "cac", label: "CAC", fmt: "money2", flag: m => m.cac > m.becac },
  { k: "becac", label: "Break-even CAC", fmt: "money2" },
  { k: "roas", label: "ROAS", fmt: "x", flag: m => m.roas < m.beroas },
  { k: "beroas", label: "Break-even ROAS", fmt: "x" },
  { k: "ltv", label: "90-day LTV", fmt: "money2", flag: m => m.ltv < m.cac },
  { k: "cvr", label: "Conversion rate", fmt: "pct2" },
  { k: "aov", label: "AOV", fmt: "money2" }
];
const LANE = Object.fromEntries(LANES.map(l => [l.k, l]));

const TILES = ["cp", "cm", "cac", "roas", "beroas", "ltv", "cvr", "aov"].map(k => ({ k }));

const AI_PROMPT = `I'm filling in my Offer Optimization Dashboard. Using the Shopify and ad platform reports I give you, work out my numbers week by week and reply with JSON only: no explanation, no code fences, no extra keys.

Weeks start on Monday. Use this exact shape, one object per week:

{
  "weeks": [
    {
      "weekStarting": "2026-10-05",
      "netSales": 0,
      "orders": 0,
      "newCustomers": 0,
      "sessions": 0,
      "adSpend": 0,
      "adRevenue": 0,
      "productCosts": 0,
      "shipping": 0,
      "paymentFees": 0,
      "otherCosts": 0,
      "repeatRate": 0
    }
  ]
}

What each one means. "weekStarting" is the Monday the week begins, as YYYY-MM-DD. "netSales" is Shopify net sales for the week, after discounts and returns. "orders" is total orders. "newCustomers" is first-time customers. "sessions" is online store sessions. "adSpend" is total ad spend across every platform. "adRevenue" is the purchase value your ad platforms report for that spend. "productCosts" is what you paid suppliers for the products sold that week. "shipping" is what you paid for postage, pick and pack. "paymentFees" is payment processing fees in money, not a percentage. "otherCosts" is any other per-order cost, such as packaging or per-order app fees. "repeatRate" is the average number of repeat orders a new customer places within 90 days, such as 0.4, taken from Shopify's customer cohort report. If it's only known overall, use the same number for every week.

Every money figure is a plain number in one currency, with no symbol, commas or spaces. Use 0 for anything you genuinely cannot find, and never estimate or invent a figure.`;

/* ---------- state ---------- */

let state = load();
const VIEWS = ["dashboard", "inputs"];
let view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "dashboard";
let year = pickDefaultYear();
let dashMode = "week";
let layout = "blocks";
const selected = { week: null, month: null };

function blankState() { return { version: 1, currency: "$", weeks: {} }; }

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.weeks === "object") return Object.assign(blankState(), parsed);
    }
  } catch {}
  return exampleState();
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  if (typeof driveAutosave === "function") driveAutosave();
}

/* ---------- dates (UTC, ISO weeks) ---------- */

// Week 1 is the first week that starts (on a Monday) in January.
function week1Monday(y) {
  const jan1 = Date.UTC(y, 0, 1);
  const dow = (new Date(jan1).getUTCDay() + 6) % 7;
  return jan1 + ((7 - dow) % 7) * DAY;
}
function weeksIn(y) { return Math.round((week1Monday(y + 1) - week1Monday(y)) / (7 * DAY)); }
function weekStart(y, n) { return week1Monday(y) + (n - 1) * 7 * DAY; }
function weekNumber(t) { return Math.round((t - week1Monday(yearOfWeek(t))) / (7 * DAY)) + 1; }
function weekName(t) { return "W" + weekNumber(t) + " \u2022 " + yearOfWeek(t); }
function isoKey(t) { return new Date(t).toISOString().slice(0, 10); }
function keyTime(k) { return Date.parse(k + "T00:00:00Z"); }
function monthOfWeek(t) { return new Date(t).getUTCMonth(); }
function yearOfWeek(t) { return new Date(t).getUTCFullYear(); }
function shortDate(t) { const d = new Date(t); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()]; }
function toMonday(str) {
  const m = String(str || "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return isoKey(t - dow * DAY);
}
function todayUTC() { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); }

function yearsWithData() {
  const ys = new Set(Object.keys(state.weeks).map(k => yearOfWeek(keyTime(k))));
  ys.add(yearOfWeek(todayUTC()));
  ys.add(year);
  return [...ys].sort();
}
function pickDefaultYear() {
  const ys = Object.keys(state.weeks).map(k => yearOfWeek(keyTime(k)));
  return ys.length ? Math.max(...ys) : yearOfWeek(todayUTC());
}

/* ---------- maths ---------- */

function hasData(w) { return w && KEYS.some(k => Number.isFinite(w[k]) && w[k] !== 0); }
function div(a, b) { return b ? a / b : NaN; }

function aggregate(keys) {
  const rows = keys.map(k => state.weeks[k]).filter(hasData);
  if (!rows.length) return null;
  const s = {};
  KEYS.forEach(k => { s[k] = rows.reduce((a, r) => a + (Number(r[k]) || 0), 0); });
  const withRate = rows.filter(r => Number(r.repeatRate) > 0);
  const weight = withRate.reduce((a, r) => a + (Number(r.newCustomers) || 0), 0);
  s.repeatRate = !withRate.length ? 0
    : weight > 0 ? withRate.reduce((a, r) => a + r.repeatRate * (Number(r.newCustomers) || 0), 0) / weight
    : withRate.reduce((a, r) => a + r.repeatRate, 0) / withRate.length;
  return metrics(s);
}

function metrics(s) {
  const before = s.netSales - s.productCosts - s.shipping - s.paymentFees - s.otherCosts;
  const cp = before - s.adSpend;
  const becac = div(before, s.orders);
  return {
    before: s.netSales ? before : NaN,
    cmb: div(before, s.netSales),
    cp: s.netSales ? cp : NaN,
    cm: div(cp, s.netSales),
    cac: div(s.adSpend, s.newCustomers),
    becac,
    roas: div(s.adRevenue, s.adSpend),
    beroas: before > 0 ? s.netSales / before : NaN,
    ltv: Number.isFinite(becac) ? becac * (1 + (s.repeatRate || 0)) : NaN,
    cvr: div(s.orders, s.sessions),
    aov: div(s.netSales, s.orders)
  };
}

function yearData(y = year) {
  const n = weeksIn(y);
  const weekKeys = Array.from({ length: n }, (_, i) => isoKey(weekStart(y, i + 1)));
  const byMonth = MONTHS.map(() => []);
  weekKeys.forEach(k => byMonth[monthOfWeek(keyTime(k))].push(k));
  return {
    weekKeys,
    weekM: weekKeys.map(k => aggregate([k])),
    monthM: byMonth.map(aggregate),
    yearM: aggregate(weekKeys)
  };
}

/* ---------- formatting ---------- */

function fmt(v, type) {
  if (!Number.isFinite(v)) return "–";
  const neg = v < 0, a = Math.abs(v), cur = state.currency || "$";
  let out;
  if (type === "money0") out = cur + a.toLocaleString("en-US", { maximumFractionDigits: 0 });
  else if (type === "money2") out = cur + a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  else if (type === "pct1") out = (a * 100).toFixed(1) + "%";
  else if (type === "pct2") out = (a * 100).toFixed(2) + "%";
  else out = a.toFixed(2) + "x";
  return neg ? "(" + out + ")" : out;
}

function change(cur, prev, type, unit) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return "";
  const tail = " vs last " + unit;
  if (type === "pct1" || type === "pct2") {
    const pts = (cur - prev) * 100;
    if (Math.abs(pts) < 0.05) return "No change" + tail;
    return (pts > 0 ? "▲ " : "▼ ") + Math.abs(pts).toFixed(1) + " pts" + tail;
  }
  if (!prev) return "";
  const rel = (cur - prev) / Math.abs(prev);
  if (Math.abs(rel) < 0.005) return "No change" + tail;
  return (rel > 0 ? "▲ " : "▼ ") + Math.round(Math.abs(rel) * 100) + "%" + tail;
}

/* ---------- DOM helpers ---------- */

const $ = sel => document.querySelector(sel);
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
let toastTimer;
function notify(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ---------- dashboard ---------- */

function latestIndex(series) {
  for (let i = series.length - 1; i >= 0; i--) if (series[i]) return i;
  return -1;
}

function barChart(series, key, labels, idx, onPick, ghostSeries) {
  const lane = LANE[key];
  const vals = series.map(m => (m ? m[key] : NaN));
  const ghosts = vals.map((_, i) => (ghostSeries && ghostSeries[i] ? ghostSeries[i][key] : NaN));
  const finite = vals.concat(ghosts).filter(Number.isFinite);
  const min = Math.min(0, ...finite), max = Math.max(0, ...finite);
  const range = max - min || 1;
  const place = (node, v) => {
    node.style.setProperty("--b", ((Math.min(v, 0) - min) / range * 100) + "%");
    node.style.setProperty("--h", Math.max(Math.abs(v) / range * 100, 0.8) + "%");
  };
  const wrap = el("div", "chart");
  const bars = el("div", "bars");
  vals.forEach((v, i) => {
    const b = el("button", "bar" + (i === idx ? " selected" : ""));
    b.type = "button";
    const g = ghosts[i];
    if (Number.isFinite(g)) { const gs = el("i", "ghost"); place(gs, g); b.append(gs); }
    const span = el("span");
    const lines = [labels.full[i], Number.isFinite(v) ? fmt(v, lane.fmt) : "No data"];
    if (Number.isFinite(g)) lines.push(labels.ghost + ": " + fmt(g, lane.fmt));
    b.dataset.tip = lines.join("\n");
    b.setAttribute("aria-label", lines.join(", "));
    if (Number.isFinite(v)) {
      place(span, v);
      b.addEventListener("click", () => onPick(i));
    } else {
      b.classList.add("no-data");
      b.setAttribute("aria-disabled", "true");
    }
    b.append(span);
    bars.append(b);
  });
  if (min < 0) {
    const zr = el("div", "zero");
    zr.style.bottom = ((0 - min) / range * 100) + "%";
    bars.append(zr);
  }
  const axis = el("div", "axis");
  axis.setAttribute("aria-hidden", "true");
  labels.short.forEach(t => axis.append(el("span", "", t)));
  wrap.append(bars, axis);
  return wrap;
}

/* instant hover readout for the bars */
const tip = el("div", "chart-tip");
tip.hidden = true;
tip.setAttribute("aria-hidden", "true");
document.body.append(tip);
function showTip(bar) {
  const [head, value, ghost] = bar.dataset.tip.split("\n");
  tip.replaceChildren(el("span", "tip-head", head), el("strong", "tip-value", value));
  if (ghost) tip.append(el("span", "tip-ghost", ghost));
  tip.hidden = false;
  const r = bar.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
  const x = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), innerWidth - tw - 8);
  const top = r.top - th - 8;
  tip.style.left = x + "px";
  tip.style.top = (top < 8 ? r.bottom + 8 : top) + "px";
}
function hideTip() { tip.hidden = true; }
document.addEventListener("pointerover", e => { const b = e.target.closest && e.target.closest(".bar"); if (b) showTip(b); });
document.addEventListener("pointerout", e => { const b = e.target.closest && e.target.closest(".bar"); if (b && !b.contains(e.relatedTarget)) hideTip(); });
document.addEventListener("focusin", e => { if (e.target.classList && e.target.classList.contains("bar")) showTip(e.target); });
document.addEventListener("focusout", hideTip);
addEventListener("scroll", hideTip, true);

// The period before the first week or month of the year comes from the year before.
function previousYearTail() {
  if (dashMode === "week") return aggregate([isoKey(week1Monday(year) - 7 * DAY)]);
  const keys = [];
  for (let n = 1; n <= weeksIn(year - 1); n++) {
    const t = weekStart(year - 1, n);
    if (monthOfWeek(t) === 11) keys.push(isoKey(t));
  }
  return aggregate(keys);
}

function renderDashboard(d) {
  const has = !!d.yearM;
  $("#emptyDash").hidden = has;
  $("#modeWeek").setAttribute("aria-pressed", dashMode === "week");
  $("#modeMonth").setAttribute("aria-pressed", dashMode === "month");
  $("#layoutBlocks").setAttribute("aria-pressed", layout === "blocks");
  $("#layoutTable").setAttribute("aria-pressed", layout === "table");
  $("#tiles").hidden = !has || layout !== "blocks";
  $("#monthWrap").hidden = !has || layout !== "table" || dashMode !== "month";
  $("#weekWrap").hidden = !has || layout !== "table" || dashMode !== "week";
  $("#ghostKey").hidden = true;
  if (!has) { $("#periodLabel").textContent = String(year); return; }
  if (layout === "table") {
    $("#periodLabel").textContent = (dashMode === "week" ? "Weekly " : "Monthly ") + year;
    if (dashMode === "week") renderWeekly(d); else renderMonthly(d);
    return;
  }

  const series = dashMode === "week" ? d.weekM : d.monthM;
  const last = yearData(year - 1);
  const ghostSeries = dashMode === "week" ? last.weekM : last.monthM;
  let idx = selected[dashMode];
  if (idx === null || !series[idx]) idx = latestIndex(series);
  selected[dashMode] = idx;

  let labels, unit, period;
  if (dashMode === "week") {
    unit = "week";
    let lastMonth = -1;
    labels = {
      ghost: "Same week " + (year - 1),
      full: d.weekKeys.map(k => weekName(keyTime(k)) + ", " + shortDate(keyTime(k))),
      short: d.weekKeys.map(k => {
        const m = monthOfWeek(keyTime(k));
        if (m === lastMonth) return "";
        lastMonth = m;
        return MONTHS[m].charAt(0);
      })
    };
    period = "Week of " + shortDate(keyTime(d.weekKeys[idx])) + " " + year;
  } else {
    unit = "month";
    labels = { ghost: "Same month " + (year - 1), full: MONTHS_LONG.map(m => m + " " + year), short: MONTHS.map(m => m.charAt(0)) };
    period = MONTHS_LONG[idx] + " " + year;
  }
  $("#periodLabel").textContent = period;
  $("#ghostKey").hidden = !ghostSeries.some(Boolean);
  $("#ghostKey").textContent = "Dotted bars show " + (year - 1);

  const m = series[idx];
  const prev = idx > 0 ? series[idx - 1] : previousYearTail();
  const pick = i => { selected[dashMode] = i; hideTip(); renderDashboard(d); };

  const tiles = $("#tiles");
  tiles.replaceChildren();
  TILES.forEach(t => {
    const lane = LANE[t.k];
    const tile = el("article", "tile m-" + t.k);
    tile.append(el("h2", "tile-head", lane.label));
    const body = el("div", "tile-body");
    body.append(el("p", "tile-value", fmt(m[t.k], lane.fmt)));
    const ch = prev ? change(m[t.k], prev[t.k], lane.fmt, unit) : "";
    body.append(el("p", "tile-change", ch || " "));
    body.append(barChart(series, t.k, labels, idx, pick, ghostSeries));
    tile.append(body);
    tiles.append(tile);
  });
}

/* ---------- monthly + weekly ---------- */

function shade(cells) {
  const vals = cells.map(c => c.v).filter(Number.isFinite);
  const min = Math.min(...vals), max = Math.max(...vals);
  cells.forEach(c => {
    if (!Number.isFinite(c.v)) return;
    const a = max > min ? 15 + 65 * (c.v - min) / (max - min) : 45;
    c.td.style.setProperty("--a", a.toFixed(0) + "%");
  });
}

function laneRow(lane, series, extra) {
  const tr = el("tr", "m-" + lane.k);
  const th = el("th", "lane", lane.label);
  th.scope = "row";
  tr.append(th);
  const cells = series.map(m => {
    const v = m ? m[lane.k] : NaN;
    const td = el("td", Number.isFinite(v) ? "" : "empty", fmt(v, lane.fmt));
    if (m && lane.flag && Number.isFinite(v) && lane.flag(m)) { td.classList.add("flag"); td.title = "Outside your limit"; }
    tr.append(td);
    return { td, v };
  });
  shade(cells);
  if (extra) tr.append(extra);
  return tr;
}

function renderMonthly(d) {
  const t = $("#monthTable");
  t.replaceChildren(el("thead"), el("tbody"));
  const hr = el("tr");
  hr.append(el("th", "corner"));
  MONTHS.forEach(name => hr.append(el("th", "", name)));
  hr.append(el("th", "year-head", String(year)));
  t.tHead.append(hr);
  LANES.forEach(lane => {
    const yv = d.yearM ? d.yearM[lane.k] : NaN;
    const ytd = el("td", "year", fmt(yv, lane.fmt));
    t.tBodies[0].append(laneRow(lane, d.monthM, ytd));
  });
}

function renderWeekly(d) {
  const t = $("#weekTable");
  t.replaceChildren(el("thead"), el("tbody"));
  const hr = el("tr");
  hr.append(el("th", "corner"));
  d.weekKeys.forEach((k, i) => {
    const th = el("th", "", "W" + (i + 1));
    th.append(el("small", "", shortDate(keyTime(k))));
    hr.append(th);
  });
  t.tHead.append(hr);
  LANES.forEach(lane => t.tBodies[0].append(laneRow(lane, d.weekM)));
}

/* ---------- inputs ---------- */

function colLetter(i) { let s = ""; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }

function inputWeeks() {
  const keys = Object.keys(state.weeks).sort();
  const thisYear = yearOfWeek(todayUTC());
  const first = keys.length ? keyTime(keys[0]) : week1Monday(thisYear);
  const lastYear = Math.max(thisYear, keys.length ? yearOfWeek(keyTime(keys[keys.length - 1])) : thisYear);
  const end = weekStart(lastYear, weeksIn(lastYear));
  const out = [];
  for (let t = first; t <= end; t += 7 * DAY) out.push(t);
  return out;
}

function renderInputs() {
  const t = $("#inputTable");
  t.replaceChildren(el("thead"), el("tbody"));
  const letters = el("tr", "letters");
  letters.append(el("th", "rownum"));
  letters.append(el("th", "week", "A"));
  FIELDS.forEach((f, i) => letters.append(el("th", "field-col", colLetter(i + 1))));
  const names = el("tr", "names");
  names.append(el("th", "rownum", "1"));
  names.append(el("th", "week", "Week"));
  FIELDS.forEach(f => {
    const th = el("th", "field-col", f.short);
    th.dataset.full = f.label;
    th.setAttribute("aria-label", f.label);
    names.append(th);
  });
  t.tHead.append(letters, names);
  const today = todayUTC();
  inputWeeks().forEach((start, i) => {
    const key = isoKey(start);
    const row = state.weeks[key] || {};
    const n = weekNumber(start);
    const tr = el("tr", (start > today ? "future" : "") + (n === 1 && i > 0 ? " year-start" : ""));
    tr.append(el("th", "rownum", String(i + 2)));
    const wk = el("th", "week", weekName(start));
    wk.scope = "row";
    wk.append(el("span", "", shortDate(start) + " \u2013 " + shortDate(start + 6 * DAY)));
    tr.append(wk);
    FIELDS.forEach(f => {
      const td = el("td", "field-col");
      const input = el("input");
      input.type = "number";
      input.inputMode = "decimal";
      input.step = "any";
      input.id = "in-" + key + "-" + f.k;
      input.dataset.week = key;
      input.dataset.field = f.k;
      input.setAttribute("aria-label", f.label + ", " + weekName(start));
      if (Number.isFinite(row[f.k])) input.value = row[f.k];
      td.append(input);
      tr.append(td);
    });
    t.tBodies[0].append(tr);
  });
}

$("#inputTable").addEventListener("input", e => {
  const input = e.target.closest("input");
  if (!input) return;
  const { week, field } = input.dataset;
  const v = input.value === "" ? NaN : Number(input.value);

  const row = state.weeks[week] || (state.weeks[week] = {});
  if (Number.isFinite(v)) row[field] = v; else delete row[field];
  if (!Object.keys(row).length) delete state.weeks[week];
  save();
});

/* ---------- tabs, year, render ---------- */

function render() {
  document.body.classList.toggle("on-inputs", view === "inputs");
  document.body.classList.toggle("on-dash", view === "dashboard");
  document.querySelectorAll(".tab-list button").forEach(b => b.setAttribute("aria-selected", b.dataset.view === view));
  $("#viewDashboard").hidden = view !== "dashboard";
  $("#viewInputs").hidden = view !== "inputs";

  const sel = $("#yearSelect");
  sel.replaceChildren(...yearsWithData().map(y => { const o = el("option", "", String(y)); o.value = y; return o; }));
  sel.value = year;

  if (view === "inputs") return renderInputs();
  renderDashboard(yearData());
}

document.querySelectorAll(".tab-list button").forEach(b => b.addEventListener("click", () => {
  view = b.dataset.view;
  try { history.replaceState(null, "", "#" + view); } catch {}
  render();
}));
$("#yearSelect").addEventListener("change", e => {
  year = Number(e.target.value);
  selected.week = selected.month = null;
  render();
});
$("#modeWeek").addEventListener("click", () => { dashMode = "week"; render(); });
$("#modeMonth").addEventListener("click", () => { dashMode = "month"; render(); });
$("#layoutBlocks").addEventListener("click", () => { layout = "blocks"; render(); });
$("#layoutTable").addEventListener("click", () => { layout = "table"; render(); });

/* ---------- paste from AI ---------- */

const pasteDialog = $("#pasteDialog");
const pasteInput = $("#pasteInput");
const pasteError = $("#pasteError");

function toNumber(v) {
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function parsePasted(raw) {
  const text = String(raw || "").trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  const starts = [text.indexOf("{"), text.indexOf("[")].filter(i => i !== -1);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  let parsed;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const out = { weeks: {}, currency: null };
  if (parsed && !Array.isArray(parsed) && typeof parsed.currency === "string") out.currency = parsed.currency;
  let list = Array.isArray(parsed) ? parsed : parsed && parsed.weeks;
  if (list && !Array.isArray(list) && typeof list === "object") {
    list = Object.entries(list).map(([k, v]) => Object.assign({ weekStarting: k }, v));
  }
  if (!Array.isArray(list)) return null;
  list.forEach(item => {
    if (!item || typeof item !== "object") return;
    const key = toMonday(item.weekStarting || item.week || item.date);
    if (!key) return;
    const row = {};
    KEYS.forEach(k => {
      if (item[k] === undefined || item[k] === null || item[k] === "") return;
      const n = toNumber(item[k]);
      if (Number.isFinite(n)) row[k] = n;
    });
    if (Object.keys(row).length) out.weeks[key] = Object.assign(out.weeks[key] || {}, row);
  });
  return Object.keys(out.weeks).length ? out : null;
}

function currentAsCode() {
  const keys = Object.keys(state.weeks).sort();
  if (!keys.length) return '{\n  "weeks": []\n}';
  const lines = keys.map(k => {
    const row = { weekStarting: k };
    KEYS.forEach(f => { if (Number.isFinite(state.weeks[k][f])) row[f] = state.weeks[k][f]; });
    return "    " + JSON.stringify(row);
  });
  return '{\n  "weeks": [\n' + lines.join(",\n") + "\n  ]\n}";
}

$("#openPaste").addEventListener("click", () => {
  pasteError.hidden = true;
  pasteInput.value = currentAsCode();
  pasteDialog.showModal();
  document.body.classList.add("dialog-open");
  pasteInput.focus();
  pasteInput.setSelectionRange(0, 0);
  pasteInput.scrollTop = 0;
});
pasteDialog.addEventListener("close", () => document.body.classList.remove("dialog-open"));
pasteDialog.addEventListener("click", e => {
  const b = pasteDialog.getBoundingClientRect();
  if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) pasteDialog.close();
});
$("#closePaste").addEventListener("click", () => pasteDialog.close());

$("#copyPrompt").addEventListener("click", () => {
  const fallback = () => {
    const tmp = el("textarea");
    tmp.value = AI_PROMPT;
    tmp.setAttribute("readonly", "");
    tmp.className = "visually-label";
    pasteDialog.append(tmp);
    tmp.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch {}
    tmp.remove();
    pasteInput.focus();
    notify(copied ? "AI instructions copied." : "Your browser blocked copying. Try again in Chrome or Safari.");
  };
  try { navigator.clipboard.writeText(AI_PROMPT).then(() => notify("AI instructions copied."), fallback); }
  catch { fallback(); }
});

$("#applyPaste").addEventListener("click", () => {
  const data = parsePasted(pasteInput.value);
  if (!data) {
    pasteError.textContent = "Couldn't read that. Paste the JSON your AI returned, with a weekStarting date on every week.";
    pasteError.hidden = false;
    return;
  }
  if (state.example) {
    const same = Object.keys(data.weeks).every(k => state.weeks[k] && KEYS.every(f => state.weeks[k][f] === data.weeks[k][f]));
    if (!same) state = blankState();
  }
  Object.entries(data.weeks).forEach(([k, row]) => { state.weeks[k] = Object.assign(state.weeks[k] || {}, row); });
  if (data.currency) state.currency = data.currency;
  save();
  const count = Object.keys(data.weeks).length;
  year = Math.max(...Object.keys(data.weeks).map(k => yearOfWeek(keyTime(k))));
  selected.week = selected.month = null;
  pasteDialog.close();
  render();
  notify("Filled " + count + (count === 1 ? " week." : " weeks."));
});

/* ---------- reset ---------- */

let resetArmed = false, resetTimer;
$("#resetAll").addEventListener("click", e => {
  if (!resetArmed) {
    resetArmed = true;
    e.target.textContent = "Click Again To Erase Everything";
    e.target.classList.add("danger");
    resetTimer = setTimeout(() => { resetArmed = false; e.target.textContent = "Clear All Data"; e.target.classList.remove("danger"); }, 4000);
    return;
  }
  clearTimeout(resetTimer);
  resetArmed = false;
  e.target.textContent = "Clear All Data";
  e.target.classList.remove("danger");
  state = blankState();
  save();
  year = yearOfWeek(todayUTC());
  selected.week = selected.month = null;
  pasteInput.value = currentAsCode();
  render();
  notify("Everything erased.");
});

/* ---------- example data ---------- */

// Loads the example store. It never touches a Google Drive file: the page stops syncing to it first.
function loadExample() {
  if (drive.file) { drive.file = null; setDriveLast(null); idleStatus(); }
  state = exampleState();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  year = pickDefaultYear();
  selected.week = selected.month = null;
  if (pasteDialog.open) pasteInput.value = currentAsCode();
  render();
  notify("Example data loaded. Play around, then Paste From AI to swap in your own.");
}
document.querySelectorAll(".load-example").forEach(b => b.addEventListener("click", loadExample));

function exampleState() {
  const s = blankState();
  s.example = true;
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const first = Date.UTC(2025, 5, 30);   // Mon 30 Jun 2025
  const offerChange = Date.UTC(2026, 6, 6); // new offer from Mon 6 Jul 2026
  const last = Date.UTC(2026, 9, 5);     // Mon 5 Oct 2026
  for (let t = first, i = 0; t <= last; t += 7 * DAY, i++) {
    const newOffer = t >= offerChange;
    const bf = t === Date.UTC(2025, 10, 24) || t === Date.UTC(2025, 11, 1); // Black Friday and Cyber week
    const xmasLull = t === Date.UTC(2025, 11, 22) || t === Date.UTC(2025, 11, 29);
    const lift = bf ? 1.55 : xmasLull ? 0.8 : 1;
    const sessions = Math.round((13800 + i * 120 + (rand() - 0.5) * 1400) * lift);
    const cvr = (newOffer ? 0.0236 : 0.0197) * (bf ? 1.35 : 1) + (rand() - 0.5) * 0.0022;
    const orders = Math.round(sessions * cvr);
    const aov = (newOffer ? 57.6 : bf ? 45.9 : 50.2) + (rand() - 0.5) * 2.4;
    const netSales = Math.round(orders * aov);
    const adSpend = Math.round(((newOffer ? 8900 : 6500) + i * 40 + (rand() - 0.5) * 600) * (bf ? 1.6 : xmasLull ? 0.7 : 1));
    s.weeks[isoKey(t)] = {
      netSales,
      orders,
      newCustomers: Math.round(orders * ((bf ? 0.82 : 0.76) + (rand() - 0.5) * 0.06)),
      sessions,
      adSpend,
      adRevenue: Math.round(netSales * (0.82 + (rand() - 0.5) * 0.06)),
      productCosts: Math.round(orders * (newOffer ? 17.6 : 15.2)),
      shipping: Math.round(orders * 5.1),
      paymentFees: Math.round(netSales * 0.029 + orders * 0.3),
      otherCosts: Math.round(orders * 1.0),
      repeatRate: newOffer ? 0.42 : 0.36
    };
  }
  return s;
}

/* ---------- Google Drive (works like draw.io) ---------- */

// Paste the OAuth client ID from Google Cloud here. While it's empty, Drive saving stays switched off.
const DRIVE_CLIENT_ID = "889111204943-edo28tmkq0e2224mg86prldvujm907cd.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_LAST_KEY = "ca-offer-dashboard-drive";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const drive = { token: null, expires: 0, client: null, file: null, timer: null, busy: false };

function driveLast() { try { return JSON.parse(localStorage.getItem(DRIVE_LAST_KEY)) || null; } catch { return null; } }
function setDriveLast(f) {
  try { f ? localStorage.setItem(DRIVE_LAST_KEY, JSON.stringify(f)) : localStorage.removeItem(DRIVE_LAST_KEY); } catch {}
}
function driveConnected() { return !!drive.token && Date.now() < drive.expires; }
function cleanName(n) { return String(n || "").replace(/\.json$/i, ""); }

function loadGoogle() {
  if (!DRIVE_CLIENT_ID || document.getElementById("gis")) return;
  const sc = document.createElement("script");
  sc.id = "gis";
  sc.src = "https://accounts.google.com/gsi/client";
  sc.async = true;
  sc.onerror = () => { drive.unavailable = true; };
  document.head.append(sc);
}

// Must run straight from a click, or the browser blocks Google's sign-in window.
function connectDrive(then) {
  if (!(window.google && google.accounts && google.accounts.oauth2)) {
    return showDriveError(drive.unavailable
      ? "Google Drive can't load here. Open the live dashboard to use it."
      : "Google is still loading. Give it a second and try again.");
  }
  if (!drive.client) {
    drive.client = google.accounts.oauth2.initTokenClient({ client_id: DRIVE_CLIENT_ID, scope: DRIVE_SCOPE, callback: () => {} });
  }
  drive.client.callback = r => {
    if (r.error) return showDriveError("Google sign-in didn't finish. Try again.");
    drive.token = r.access_token;
    drive.expires = Date.now() + (Number(r.expires_in) - 60) * 1000;
    then();
  };
  drive.client.error_callback = () => showDriveError("The Google sign-in window was closed before it finished.");
  drive.client.requestAccessToken({ prompt: driveLast() ? "" : "consent" });
}

async function api(url, opts = {}) {
  if (!driveConnected()) throw Object.assign(new Error("expired"), { expired: true });
  const res = await fetch(url, Object.assign({}, opts, {
    headers: Object.assign({ Authorization: "Bearer " + drive.token }, opts.headers || {})
  }));
  if (res.status === 401) { drive.token = null; throw Object.assign(new Error("expired"), { expired: true }); }
  if (res.status === 404) throw Object.assign(new Error("That file isn't in your Google Drive any more."), { missing: true });
  if (!res.ok) throw new Error("Google Drive couldn't do that (error " + res.status + "). Try again in a moment.");
  return res;
}

function fileContent() {
  return JSON.stringify({ version: 1, currency: state.currency, example: !!state.example, weeks: state.weeks });
}

async function listFiles() {
  const q = encodeURIComponent("appProperties has { key='caOfferDashboard' and value='1' } and trashed=false");
  const res = await api(API + "?q=" + q + "&orderBy=modifiedTime%20desc&pageSize=50&fields=files(id,name,modifiedTime)");
  return (await res.json()).files || [];
}

async function createFile(name) {
  const boundary = "ca" + Math.random().toString(36).slice(2);
  const meta = { name: name + ".json", mimeType: "application/json", appProperties: { caOfferDashboard: "1" } };
  const body = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta)
    + "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" + fileContent() + "\r\n--" + boundary + "--";
  const res = await api(UPLOAD + "?uploadType=multipart&fields=id,name,modifiedTime", {
    method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body
  });
  return res.json();
}

async function updateFile(id, name) {
  if (name) {
    await api(API + "/" + id + "?fields=id", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name + ".json" })
    });
  }
  const res = await api(UPLOAD + "/" + id + "?uploadType=media&fields=id,name,modifiedTime", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: fileContent()
  });
  return res.json();
}

async function readFile(id) {
  const res = await api(API + "/" + id + "?alt=media");
  const data = await res.json();
  if (!data || typeof data.weeks !== "object") throw new Error("That file isn't an Offer Optimization Dashboard.");
  return data;
}

function remember(file, pending) {
  drive.file = { id: file.id, name: cleanName(file.name) };
  setDriveLast({ id: drive.file.id, name: drive.file.name, pending: !!pending });
  addRecent(drive.file);
}

/* Open Recent: the last files opened or saved in this browser */
const RECENT_KEY = "ca-offer-dashboard-recent";
function recents() { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } }
function setRecents(list) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))); } catch {} }
function addRecent(f) { setRecents([{ id: f.id, name: f.name, at: Date.now() }].concat(recents().filter(r => r.id !== f.id))); }
function dropRecent(id) { setRecents(recents().filter(r => r.id !== id)); }

/* status in the bottom bar */
function driveStatus(text) {
  const b = $("#driveStatus");
  if (!DRIVE_CLIENT_ID || !text) { b.hidden = true; return; }
  b.hidden = false;
  b.textContent = text;
}
function idleStatus() {
  const last = driveLast();
  if (driveConnected() && drive.file) driveStatus("Saved to Drive • " + drive.file.name);
  else if (last) driveStatus("Drive • " + last.name + " • Reconnect");
  else driveStatus("");
}

/* autosave, called from save() */
function driveAutosave() {
  const last = driveLast();
  if (!DRIVE_CLIENT_ID || !last) return;
  if (!driveConnected()) {
    setDriveLast(Object.assign(last, { pending: true }));
    driveStatus("Not saved to Drive • Reconnect");
    return;
  }
  clearTimeout(drive.timer);
  driveStatus("Saving…");
  drive.timer = setTimeout(async () => {
    try {
      const f = await updateFile(drive.file.id);
      remember(f, false);
      idleStatus();
    } catch (err) {
      setDriveLast(Object.assign(driveLast() || {}, { pending: true }));
      driveStatus(err.expired ? "Not saved to Drive • Reconnect" : "Drive save failed • Retry");
    }
  }, 1200);
}

/* reconnect from the bottom bar: newer copy wins */
$("#driveStatus").addEventListener("click", () => {
  const last = driveLast();
  if (driveConnected()) {
    if (drive.file && /failed|Not saved/.test($("#driveStatus").textContent)) return driveAutosave();
    return openOpenDialog();
  }
  if (!last) return openOpenDialog();
  connectDrive(async () => {
    driveStatus("Opening…");
    try {
      drive.file = { id: last.id, name: last.name };
      if (last.pending) {
        const f = await updateFile(last.id);
        remember(f, false);
        notify("Your latest numbers were saved to Drive.");
      } else {
        loadDriveData(await readFile(last.id));
        notify("Opened " + last.name + " from Drive.");
      }
      idleStatus();
    } catch (err) {
      drive.file = null;
      driveStatus("Drive • " + last.name + " • Reconnect");
      notify(err.expired ? "Google sign-in expired. Try again." : "Couldn't open that file. It may have been deleted.");
    }
  });
});

function loadDriveData(data) {
  state = Object.assign(blankState(), { currency: data.currency || "$", example: !!data.example, weeks: data.weeks });
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  year = pickDefaultYear();
  selected.week = selected.month = null;
  render();
}

/* ---------- the Google Drive menu, like draw.io's File menu ---------- */

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const menuBtn = $("#driveMenuBtn");
const menu = $("#driveMenu");
$("#mSaveKey").textContent = isMac ? "⌘S" : "Ctrl+S";

function showDriveError(msg) {
  const open = [...document.querySelectorAll("dialog")].find(d => d.open && d.querySelector(".drive-error"));
  if (open) {
    const e = open.querySelector(".drive-error");
    e.textContent = msg;
    e.hidden = !msg;
  } else if (msg) notify(msg);
}

function withDrive(action) {
  if (driveConnected()) return action();
  connectDrive(action);
}

function hasUnsaved() {
  if (state.example || !Object.keys(state.weeks).length) return false;
  const last = driveLast();
  return !last || !!last.pending;
}

// Ask before replacing numbers that aren't saved anywhere. The go button is a real click, so Google sign-in can open from it.
const confirmDialog = $("#confirmDialog");
let confirmAction = null;
function guardUnsaved(action, goLabel) {
  if (!hasUnsaved()) return action();
  confirmAction = action;
  $("#confirmGo").textContent = goLabel;
  openModal(confirmDialog);
}
$("#confirmGo").addEventListener("click", () => {
  const act = confirmAction;
  confirmAction = null;
  confirmDialog.close();
  if (act) act();
});
$("#confirmCancel").addEventListener("click", () => confirmDialog.close());

function openModal(d) {
  if (!d.open) d.showModal();
  document.body.classList.add("dialog-open");
}
document.querySelectorAll("dialog").forEach(d => {
  d.addEventListener("close", () => {
    if (![...document.querySelectorAll("dialog")].some(x => x.open)) document.body.classList.remove("dialog-open");
  });
  d.addEventListener("click", e => {
    const b = d.getBoundingClientRect();
    if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) d.close();
  });
});

/* menu open and close */
function closeMenu() { menu.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); }
function openMenu() {
  buildRecentMenu();
  $("#mDisconnect").hidden = !(driveConnected() || driveLast());
  $("#mSave").querySelector(".label").textContent = drive.file ? "Save" : "Save to Google Drive…";
  menu.hidden = false;
  menuBtn.setAttribute("aria-expanded", "true");
  const first = menu.querySelector("button:not([disabled])");
  if (first) first.focus({ preventScroll: true });
}
menuBtn.addEventListener("click", () => (menu.hidden ? openMenu() : closeMenu()));
document.addEventListener("click", e => { if (!menu.hidden && !e.target.closest(".menu-wrap")) closeMenu(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !menu.hidden) { closeMenu(); menuBtn.focus(); }
  if (!menu.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    const items = [...menu.querySelectorAll("button:not([disabled])")].filter(b => b.offsetParent);
    const i = items.indexOf(document.activeElement);
    const next = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    if (next) { e.preventDefault(); next.focus(); }
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveNow(); }
});
// Each menu item closes the menu first, then runs.
function item(id, fn) { $(id).addEventListener("click", () => { closeMenu(); fn(); }); }

/* Open Recent submenu */
function buildRecentMenu() {
  const box = $("#recentMenu");
  box.replaceChildren();
  const list = recents();
  if (!list.length) {
    const none = el("button", "menu-item", "No recent files");
    none.type = "button";
    none.disabled = true;
    box.append(none);
    return;
  }
  list.forEach(r => {
    const b = el("button", "menu-item recent-item" + (drive.file && drive.file.id === r.id ? " current" : ""));
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.append(el("span", "label", r.name), el("small", "", new Date(r.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })));
    b.addEventListener("click", () => { closeMenu(); openFile(r.id, r.name); });
    box.append(b);
  });
  box.append(el("div", "sep"));
  const clear = el("button", "menu-item", "Clear Recent");
  clear.type = "button";
  clear.addEventListener("click", () => { setRecents([]); buildRecentMenu(); });
  box.append(clear);
}
$("#mRecent").addEventListener("click", e => {
  e.stopPropagation();
  const wrap = $("#mRecentWrap");
  wrap.classList.toggle("open");
  const first = $("#recentMenu button:not([disabled])");
  if (wrap.classList.contains("open") && first) first.focus();
});

/* open a file by id */
function openFile(id, name) {
  if (drive.file && drive.file.id === id && driveConnected() && !(driveLast() || {}).pending) {
    return notify(name + " is already open.");
  }
  guardUnsaved(() => withDrive(async () => {
    driveStatus("Opening…");
    try {
      const data = await readFile(id);
      loadDriveData(data);
      remember({ id, name }, false);
      idleStatus();
      if ($("#openDialog").open) $("#openDialog").close();
      notify("Opened " + name + ".");
    } catch (err) {
      if (err.missing) dropRecent(id);
      idleStatus();
      showDriveError(err.expired ? "Google sign-in expired. Try again." : err.message);
    }
  }), "Open " + name);
}

/* Save, and Save As */
const saveDialog = $("#saveDialog");
function saveNow() {
  if (!DRIVE_CLIENT_ID) return;
  if (!drive.file) return openSaveAs();
  withDrive(async () => {
    driveStatus("Saving…");
    try {
      const f = await updateFile(drive.file.id);
      remember(f, false);
      idleStatus();
      notify("Saved to Google Drive.");
    } catch (err) {
      idleStatus();
      showDriveError(err.expired ? "Google sign-in expired. Try again." : err.message);
    }
  });
}
function openSaveAs() {
  $("#saveError").hidden = true;
  $("#saveName").value = drive.file ? drive.file.name + " copy" : "Offer Dashboard";
  openModal(saveDialog);
  $("#saveName").select();
}
function doSaveAs() {
  const name = $("#saveName").value.trim() || "Offer Dashboard";
  withDrive(async () => {
    const btn = $("#saveGo");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const f = await createFile(name);
      remember(f, false);
      idleStatus();
      saveDialog.close();
      notify("Saved " + name + " to Google Drive. Changes now save automatically.");
    } catch (err) {
      showDriveError(err.expired ? "Google sign-in expired. Try again." : err.message);
    }
    btn.disabled = false;
    btn.textContent = "Save";
  });
}
$("#saveGo").addEventListener("click", doSaveAs);
$("#saveName").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doSaveAs(); } });
$("#saveCancel").addEventListener("click", () => saveDialog.close());

/* Open: every dashboard in their Drive, newest first */
const openDialog = $("#openDialog");
let openFiles = [];
function drawOpenList() {
  const list = $("#openList");
  const q = $("#openSearch").value.trim().toLowerCase();
  const rows = openFiles.filter(f => cleanName(f.name).toLowerCase().includes(q));
  list.replaceChildren();
  if (!rows.length) {
    list.append(el("li", "empty", openFiles.length ? "No dashboards match that." : "No dashboards saved yet. Use Save to Google Drive first."));
    return;
  }
  rows.forEach(f => {
    const li = el("li");
    const b = el("button", "file-row" + (drive.file && drive.file.id === f.id ? " current" : ""));
    b.type = "button";
    const name = cleanName(f.name);
    const when = "Edited " + new Date(f.modifiedTime).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    b.append(el("span", "label", name), el("small", "", drive.file && drive.file.id === f.id ? "Open now • " + when : when));
    b.addEventListener("click", () => openFile(f.id, name));
    li.append(b);
    list.append(li);
  });
}
function openOpenDialog() {
  withDrive(async () => {
    $("#openError").hidden = true;
    $("#openSearch").value = "";
    $("#openList").replaceChildren(el("li", "empty", "Loading your dashboards…"));
    openModal(openDialog);
    try {
      openFiles = await listFiles();
      drawOpenList();
      $("#openSearch").focus();
    } catch (err) {
      $("#openList").replaceChildren();
      showDriveError(err.expired ? "Google sign-in expired. Close this and try again." : err.message);
    }
  });
}
$("#openSearch").addEventListener("input", drawOpenList);
$("#openCancel").addEventListener("click", () => openDialog.close());

/* New Dashboard: a blank sheet, not linked to any file yet */
function newDashboard() {
  guardUnsaved(() => {
    drive.file = null;
    setDriveLast(null);
    state = blankState();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
    year = yearOfWeek(todayUTC());
    selected.week = selected.month = null;
    idleStatus();
    render();
    notify("New blank dashboard. Save it to Google Drive when you're ready.");
  }, "Start New Dashboard");
}

/* Disconnect */
function disconnectDrive() {
  try { if (drive.token && window.google) google.accounts.oauth2.revoke(drive.token, () => {}); } catch {}
  drive.token = null;
  drive.file = null;
  setDriveLast(null);
  idleStatus();
  notify("Disconnected from Google Drive. Your numbers are still here.");
}

item("#mSave", saveNow);
item("#mSaveAs", openSaveAs);
item("#mOpen", openOpenDialog);
item("#mNew", newDashboard);
item("#mDisconnect", disconnectDrive);

loadGoogle();
idleStatus();

render();
