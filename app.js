/* Recomp Tracker — appli de suivi alimentaire synchronisée via Supabase.
 * Données : une table "docs" (user_id, path, data). Chemins utilisés :
 *   foods/<id>        { name, portion, kcal, prot, groups[], order }
 *   days/<AAAA-MM-JJ> { items: { "<repas>:<aliment>": quantité }, extras: [{label,kcal}], weight }
 *   weeks/<lundi>     { waist }
 *   settings/main     { kcalGoal, protGoal }
 * Hors ligne : tout est gardé dans le navigateur (localStorage) et les modifications
 * en attente sont envoyées dès que la connexion revient.
 */
(function () {
"use strict";

const CFG = window.RECOMP_CONFIG || {};
const GROUPS = { pdj: "Petit-déjeuner", col: "Collation", prot: "Protéines", fec: "Féculents", acc: "Accompagnements", sup: "Compléments" };
const MEALS = [
  { id: "pdj", label: "Petit-déjeuner", groups: ["pdj"] },
  { id: "col", label: "Collation", groups: ["col"] },
  { id: "dej", label: "Déjeuner", groups: ["prot", "fec", "acc"] },
  { id: "din", label: "Dîner", groups: ["prot", "fec", "acc"] },
  { id: "sup", label: "Compléments", groups: ["sup"] }
];
const QTY = [[0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"], [1, "1"], [1.5, "1,5"], [2, "2"], [3, "3"]];
const DEFAULT_FOODS = [
  ["avoine", "Flocons d'avoine", "80 g", 300, 11, ["pdj"]],
  ["fb250", "Fromage blanc 0 %", "250 g", 115, 20, ["pdj"]],
  ["fruits", "Fruits surgelés", "100 g", 50, 1, ["pdj", "col"]],
  ["whey", "Whey", "1 dose (30 g)", 120, 24, ["col"]],
  ["secs", "Fruits secs (amandes, noix)", "30 g", 185, 6, ["col"]],
  ["banane", "Banane", "1 moyenne", 105, 1, ["col"]],
  ["kiwi", "Kiwi / orange", "1 fruit", 50, 1, ["col"]],
  ["fb150", "Fromage blanc 0 % (collation du soir)", "150 g", 70, 12, ["col"]],
  ["poulet", "Poulet / dinde", "180 g cru", 200, 41, ["prot"]],
  ["boeuf", "Bœuf haché 5 %", "180 g cru", 245, 38, ["prot"]],
  ["merlu", "Merlu", "220 g", 160, 37, ["prot"]],
  ["crevettes", "Crevettes", "220 g", 175, 40, ["prot"]],
  ["saumon", "Saumon (sans huile ajoutée)", "150 g", 300, 30, ["prot"]],
  ["oeufs", "Œufs", "4 œufs", 290, 25, ["prot"]],
  ["sardines", "Sardines / maquereau", "1 boîte", 180, 20, ["prot"]],
  ["riz", "Riz", "85 g cru", 300, 6, ["fec"]],
  ["pates", "Pâtes complètes", "85 g crues", 300, 11, ["fec"]],
  ["pdt", "Pommes de terre", "380 g", 290, 8, ["fec"]],
  ["patate", "Patate douce", "350 g", 300, 5, ["fec"]],
  ["pain", "Pain complet", "120 g", 300, 11, ["fec"]],
  ["legumineuses", "Lentilles / pois chiches cuits", "250 g", 300, 20, ["fec"]],
  ["legumes", "Légumes surgelés", "250 g", 100, 5, ["acc"]],
  ["huile", "Huile d'olive", "1 c. à s. (10 g)", 90, 0, ["acc"]],
  ["coco", "Lait de coco light", "50 ml", 40, 0, ["acc"]],
  ["sauce", "Sauce fromage blanc", "100 g", 50, 8, ["acc"]],
  ["creatine", "Créatine", "5 g", 0, 0, ["sup"]]
];
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-ink)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';

const view = document.getElementById("view");
const tabsEl = document.getElementById("tabs");
const S = {
  user: null, docs: {}, queue: {}, loaded: false, online: navigator.onLine, syncing: false,
  tab: "jour", date: todayStr(), weekOf: null, dirty: false, confirmDel: null, collapsed: {},
  login: { mode: "in", err: "", info: "", busy: false }
};
S.weekOf = monday(S.date);
S.collapsed = lsGet("recomp-collapsed", {});

let sb = null, channel = null, flushTimer = null;

/* ---------------- utilitaires ---------------- */
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function pad(n) { return String(n).padStart(2, "0"); }
function toStr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function parse(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function todayStr() { return toStr(new Date()); }
function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return toStr(d); }
function monday(s) { const d = parse(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return toStr(d); }
const fmtLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const fmtShort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nfq = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function num(v) { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; }
let toastT;
function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }

/* ---------------- stockage local + synchro ---------------- */
function cacheKey() { return "recomp-docs-" + S.user.id; }
function queueKey() { return "recomp-queue-" + S.user.id; }
function persist() { lsSet(cacheKey(), S.docs); lsSet(queueKey(), S.queue); }

function get(path) { return S.docs[path] ?? null; }
function save(path, data) {
  if (data === null) delete S.docs[path]; else S.docs[path] = data;
  S.queue[path] = data;              // null = suppression
  persist();
  scheduleFlush(500);
}
function scheduleFlush(ms) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms); }

async function flush() {
  if (!sb || !S.user || S.syncing) return;
  const paths = Object.keys(S.queue);
  if (!paths.length) { renderSync(); return; }
  if (!navigator.onLine) { S.online = false; renderSync(); return; }
  S.syncing = true; renderSync();
  try {
    const ups = [], dels = [];
    for (const p of paths) (S.queue[p] === null ? dels : ups).push(p);
    const snapshot = Object.fromEntries(paths.map(p => [p, S.queue[p]]));
    if (ups.length) {
      const rows = ups.map(p => ({ user_id: S.user.id, path: p, data: snapshot[p], updated_at: new Date().toISOString() }));
      const { error } = await sb.from("docs").upsert(rows, { onConflict: "user_id,path" });
      if (error) throw error;
    }
    if (dels.length) {
      const { error } = await sb.from("docs").delete().eq("user_id", S.user.id).in("path", dels);
      if (error) throw error;
    }
    for (const p of paths) if (S.queue[p] === snapshot[p]) delete S.queue[p];
    persist();
    S.online = true;
  } catch (e) {
    S.online = navigator.onLine;
    scheduleFlush(15000);
  } finally {
    S.syncing = false; renderSync();
    if (Object.keys(S.queue).length && S.online) scheduleFlush(1000);
  }
}

async function pull() {
  if (!sb || !S.user || !navigator.onLine) return;
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("docs").select("path,data").eq("user_id", S.user.id).range(from, from + 999);
    if (error) { S.online = false; renderSync(); return; }
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const fresh = {};
  for (const r of rows) fresh[r.path] = r.data;
  for (const p of Object.keys(S.queue)) { if (S.queue[p] === null) delete fresh[p]; else fresh[p] = S.queue[p]; }
  S.docs = fresh; S.loaded = true; S.online = true;
  persist();
  if (!S.docs["settings/main"] && !Object.keys(S.docs).some(p => p.startsWith("foods/"))) seedDefaults();
  requestRender();
}

function seedDefaults() {
  DEFAULT_FOODS.forEach(([id, name, portion, kcal, prot, groups], i) =>
    save("foods/" + id, { name, portion, kcal, prot, groups, order: i + 1 }));
  save("settings/main", { kcalGoal: 2200, protGoal: 160 });
}

function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel("docs-" + S.user.id)
    .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "user_id=eq." + S.user.id }, payload => {
      const row = payload.new && payload.new.path ? payload.new : payload.old;
      if (!row || !row.path || row.path in S.queue) return;
      if (payload.eventType === "DELETE") delete S.docs[row.path]; else S.docs[row.path] = payload.new.data;
      persist(); requestRender();
    })
    .subscribe();
}

/* ---------------- accès aux données ---------------- */
function foods() {
  const o = {};
  for (const p in S.docs) if (p.startsWith("foods/")) o[p.slice(6)] = S.docs[p];
  return o;
}
function foodsList() {
  return Object.entries(foods()).map(([id, f]) => Object.assign({ id }, f))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.name).localeCompare(b.name));
}
function settings() { const s = get("settings/main") || {}; return { kcalGoal: Number(s.kcalGoal) || 2200, protGoal: Number(s.protGoal) || 160 }; }
function getDay(d) { return get("days/" + d); }
function getWeek(m) { return get("weeks/" + m); }
function totals(day, F) {
  F = F || foods();
  let k = 0, p = 0, n = 0;
  if (!day) return { k, p, n };
  for (const [key, q] of Object.entries(day.items || {})) {
    const f = F[key.split(":")[1]]; if (!f || !q) continue;
    k += (Number(f.kcal) || 0) * q; p += (Number(f.prot) || 0) * q; n++;
  }
  for (const e of day.extras || []) { k += Number(e.kcal) || 0; n++; }
  return { k, p, n };
}
function kState(k) { const g = settings().kcalGoal; if (!k) return ""; return k <= g + 100 ? "ok" : k <= g + 300 ? "warn" : "bad"; }
function blankDay() { return { items: {}, extras: [], weight: null }; }
function cloneDay(d) { return d ? { items: Object.assign({}, d.items || {}), extras: (d.extras || []).map(e => Object.assign({}, e)), weight: d.weight ?? null } : blankDay(); }

/* ---------------- rendu ---------------- */
function editing() { const a = document.activeElement; return a && view.contains(a) && a.matches("input,select"); }
function requestRender() { if (editing()) { S.dirty = true; return; } render(); }
view.addEventListener("focusout", () => setTimeout(() => { if (S.dirty && !editing()) { S.dirty = false; render(); } }, 0));

function syncHtml() {
  const n = Object.keys(S.queue).length;
  if (!S.online || !navigator.onLine) return `<span class="sync off" id="sync"><i></i>Hors ligne${n ? " · " + n + " modif. en attente" : ""}</span>`;
  if (n || S.syncing) return `<span class="sync wait" id="sync"><i></i>Synchronisation…</span>`;
  return `<span class="sync" id="sync"><i></i>Synchronisé</span>`;
}
function renderSync() { const el = document.getElementById("sync"); if (el) el.outerHTML = syncHtml(); }

function renderLogin() {
  const L = S.login, up = L.mode === "up";
  if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes("TON-PROJET")) {
    return `<div class="login"><h1>Recomp</h1><p>L'appli n'est pas encore reliée à ta base Supabase. Ouvre le fichier <b>config.js</b> et colle l'URL et la clé de ton projet (étape 2 du guide).</p></div>`;
  }
  return `<div class="login">
    <h1>Recomp</h1>
    <p>${up ? "Crée ton compte. Tes données seront synchronisées entre ton PC et ton téléphone." : "Connecte-toi pour retrouver tes repas sur tous tes appareils."}</p>
    <form data-form="login">
      <input id="login-email" type="email" autocomplete="email" placeholder="E-mail" required>
      <input id="login-pass" type="password" autocomplete="${up ? "new-password" : "current-password"}" placeholder="Mot de passe (6 caractères min.)" minlength="6" required>
      <button class="btn" type="submit" ${L.busy ? "disabled" : ""}>${L.busy ? "Patiente…" : up ? "Créer mon compte" : "Se connecter"}</button>
    </form>
    ${L.err ? `<div class="err">${esc(L.err)}</div>` : ""}${L.info ? `<div class="info">${esc(L.info)}</div>` : ""}
    <button class="switch" data-act="loginMode">${up ? "J'ai déjà un compte" : "Première fois ? Créer un compte"}</button>
  </div>`;
}

function renderDay() {
  const s = settings(), d = S.date, F = foods(), day = getDay(d), t = totals(day, F), st = kState(t.k);
  const g = s.kcalGoal, scale = g * 1.25, rest = g - t.k;
  const note = !t.k ? '<span class="muted">Rien de coché</span>' : rest >= 0 ? `<span class="ok">Reste ${nf0.format(rest)} kcal</span>` : `<span class="${st}">+${nf0.format(-rest)} kcal</span>`;
  const isToday = d === todayStr();
  let h = `<header class="head">
    <div class="datebar">
      <button class="icon-btn" data-act="prevDay" aria-label="Jour précédent">‹</button>
      <h1>${esc(cap(fmtLong.format(parse(d))))}</h1>
      ${isToday ? "" : '<button class="chip-today" data-act="today">Aujourd\'hui</button>'}
      <button class="icon-btn" data-act="nextDay" aria-label="Jour suivant">›</button>
    </div>
    <div class="gauges">
      <div>
        <div class="gauge-top"><div class="big num">${nf0.format(t.k)}<small>/ ${nf0.format(g)} kcal</small></div><div class="gauge-note">${note}</div></div>
        <div class="bar"><i class="${st}" style="width:${Math.min(t.k / scale, 1) * 100}%"></i><b style="left:${g / scale * 100}%"></b></div>
      </div>
      <div class="prot-row"><span class="num" style="min-width:96px"><b>${nf0.format(t.p)}</b> / ${nf0.format(s.protGoal)} g prot.</span><div class="bar"><i style="width:${Math.min(t.p / s.protGoal, 1) * 100}%"></i></div></div>
    </div>
    ${syncHtml()}
  </header>`;
  const list = foodsList();
  if (!list.length) return h + (S.loaded ? '<div class="empty">Ta liste d\'aliments est vide.<br><button class="btn" data-goto="aliments">Ajouter des aliments</button></div>' : '<div class="empty">Chargement de tes aliments…</div>');

  h += '<div class="meals">';
  if (!t.n) {
    const y = getDay(addDays(d, -1));
    if (y && totals(y, F).n) h += `<div class="card" style="display:flex;align-items:center;gap:12px"><div style="flex:1">Tu manges souvent pareil ? Reprends ce que tu as coché la veille, puis ajuste.</div><button class="btn ghost" data-act="copyPrev">Copier la veille</button></div>`;
  }
  for (const m of MEALS) {
    let mk = 0, mn = 0, body = "";
    for (const gk of m.groups) {
      const items = list.filter(f => (f.groups || []).includes(gk)); if (!items.length) continue;
      if (m.groups.length > 1) body += `<div class="sub">${esc(GROUPS[gk])}</div>`;
      for (const f of items) {
        const key = m.id + ":" + f.id, q = day && day.items ? day.items[key] : 0, on = !!q;
        if (on) { mk += (Number(f.kcal) || 0) * q; mn++; }
        const ql = on && Math.abs(q - 1) > 1e-6 ? ` · ×${nfq.format(q)}` : "";
        body += `<div class="food${on ? " on" : ""}">
          <button class="food-row" data-act="toggle" data-key="${key}" aria-pressed="${on}">
            <span class="box">${CHECK}</span>
            <span class="food-txt"><span class="food-name">${esc(f.name)}</span><br><span class="food-meta">${esc(f.portion)}${ql}</span></span>
            <span class="food-k num">${nf0.format((Number(f.kcal) || 0) * (on ? q : 1))} kcal</span>
          </button>
          ${on ? `<div class="qtys" role="group" aria-label="Quantité">${QTY.map(([v, l]) => `<button class="q${Math.abs(v - q) < 1e-3 ? " sel" : ""}" data-act="qty" data-key="${key}" data-q="${v}">${l}</button>`).join("")}</div>` : ""}
        </div>`;
      }
    }
    if (!body) continue;
    const closed = !!S.collapsed[m.id];
    h += `<section class="meal${closed ? " closed" : ""}">
      <button class="meal-h" data-act="collapse" data-meal="${m.id}" aria-expanded="${!closed}">
        <h2>${m.label}</h2><span class="sum num">${mn ? nf0.format(mk) + " kcal" : ""}</span><span class="caret">▾</span>
      </button><div class="meal-b">${body}</div></section>`;
  }
  const ex = (day && day.extras) || [];
  h += `<section class="meal"><div class="meal-h"><h2>Écarts et extras</h2><span class="sum num">${ex.length ? nf0.format(ex.reduce((a, e) => a + (Number(e.kcal) || 0), 0)) + " kcal" : ""}</span></div>
    <div class="extras">
      ${ex.map((e, i) => `<div class="extra"><span>${esc(e.label || "Écart")}</span><span class="num">${nf0.format(Number(e.kcal) || 0)} kcal</span><button class="x-btn" data-act="delExtra" data-i="${i}" aria-label="Retirer">×</button></div>`).join("")}
      <form class="add-row" data-form="extra">
        <input id="extra-label" placeholder="Ex. macaron, resto…" autocomplete="off">
        <input id="extra-kcal" class="k num" inputmode="numeric" placeholder="kcal" autocomplete="off">
        <button class="btn" type="submit">Ajouter</button>
      </form>
    </div></section>`;
  h += `<div class="card"><div class="field"><label for="weight">Poids à jeun</label><span><input id="weight" class="num" inputmode="decimal" placeholder="kg" value="${day && day.weight != null ? nf1.format(day.weight) : ""}"> kg</span></div><div class="muted" style="font-size:12.5px;margin-top:6px">Facultatif. Pèse-toi 3 à 4 matins par semaine : l'onglet Semaine calcule la moyenne.</div></div>`;
  return h + "</div>";
}

function weekStats(mon, F) {
  let sum = 0, ps = 0, n = 0, ws = 0, wn = 0; const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i), day = getDay(d), t = totals(day, F); days.push({ d, t });
    if (t.n) { sum += t.k; ps += t.p; n++; }
    if (day && day.weight != null) { ws += day.weight; wn++; }
  }
  return { days, sum, n, avg: n ? sum / n : null, pavg: n ? ps / n : null, wavg: wn ? ws / wn : null };
}
function renderWeek() {
  const F = foods(), s = settings(), mon = S.weekOf, w = weekStats(mon, F), prev = weekStats(addDays(mon, -7), F);
  const st = w.avg ? kState(w.avg) : "", diff = w.avg != null ? w.avg - s.kcalGoal : null;
  const wdiff = w.wavg != null && prev.wavg != null ? w.wavg - prev.wavg : null, wk = getWeek(mon), td = todayStr();
  let h = `<div class="title-row"><button class="icon-btn" data-act="prevWeek" aria-label="Semaine précédente">‹</button><h1>Semaine du ${esc(fmtShort.format(parse(mon)))}</h1>${mon === monday(td) ? "" : '<button class="chip-today" data-act="thisWeek">Cette semaine</button>'}<button class="icon-btn" data-act="nextWeek" aria-label="Semaine suivante">›</button></div>
  <div class="stack">
  <div class="stats">
    <div class="stat"><div class="lab">Moyenne / jour</div><div class="val num ${st}">${w.avg != null ? nf0.format(w.avg) : "–"}<small> kcal</small></div><div class="hint ${st}">${diff == null ? '<span class="muted">Aucun jour rempli</span>' : (diff > 0 ? "+" : "") + nf0.format(diff) + " vs objectif"}</div></div>
    <div class="stat"><div class="lab">Total semaine</div><div class="val num">${nf0.format(w.sum)}<small> kcal</small></div><div class="hint muted">${w.n}/7 jours remplis</div></div>
    <div class="stat"><div class="lab">Protéines / jour</div><div class="val num">${w.pavg != null ? nf0.format(w.pavg) : "–"}<small> g</small></div><div class="hint ${w.pavg != null && w.pavg >= s.protGoal - 10 ? "ok" : "muted"}">Objectif ${nf0.format(s.protGoal)} g</div></div>
    <div class="stat"><div class="lab">Poids moyen</div><div class="val num">${w.wavg != null ? nf1.format(w.wavg) : "–"}<small> kg</small></div><div class="hint ${wdiff == null ? "muted" : ""}">${wdiff == null ? "Note ton poids dans Jour" : (wdiff > 0 ? "+" : "") + nf1.format(wdiff) + " kg vs sem. préc."}</div></div>
  </div>`;
  const max = Math.max(s.kcalGoal * 1.3, ...w.days.map(x => x.t.k)), L = ["L", "M", "M", "J", "V", "S", "D"];
  h += `<div class="card"><h3>Calories par jour</h3><div class="chart">
    <div class="goal-line" style="bottom:calc(${s.kcalGoal / max} * (100% - 56px) + 20px)"><span class="goal-tag num">${nf0.format(s.kcalGoal)}</span></div>
    ${w.days.map((x, i) => { const k = x.t.k, c = k ? kState(k) : "none"; return `<button class="col${x.d === td ? " today" : ""}" data-act="gotoDay" data-d="${x.d}" aria-label="${esc(fmtLong.format(parse(x.d)))}"><span class="v num">${k ? nf0.format(k) : ""}</span><span class="stick ${c}" style="height:calc(${k / max} * (100% - 38px))"></span><span class="d">${L[i]}</span></button>`; }).join("")}
  </div></div>`;
  h += `<div class="card"><div class="field"><label for="waist">Tour de taille</label><span><input id="waist" class="num" inputmode="decimal" placeholder="cm" value="${wk && wk.waist != null ? nf1.format(wk.waist) : ""}"> cm</span></div><div class="muted" style="font-size:12.5px;margin-top:6px">Mesure une fois par semaine, le matin, au niveau du nombril.</div></div>`;
  const dayKeys = Object.keys(S.docs).filter(p => p.startsWith("days/")).map(p => p.slice(5)).sort();
  const first = dayKeys.length ? monday(dayKeys[0]) : monday(td);
  const rows = []; let m = monday(td);
  while (m >= first && rows.length < 104) {
    const ws = weekStats(m, F), w2 = getWeek(m), pw = weekStats(addDays(m, -7), F);
    const dv = ws.wavg != null && pw.wavg != null ? ws.wavg - pw.wavg : null;
    rows.push(`<button class="hist-row" data-act="gotoWeek" data-m="${m}" style="text-align:left;width:100%"><span class="w">Sem. du ${esc(fmtShort.format(parse(m)))}</span><span class="r num ${ws.avg ? kState(ws.avg) : "muted"}">${ws.avg != null ? nf0.format(ws.avg) + " kcal/j" : "–"}</span><span class="m num">${ws.n}/7 jours${ws.pavg != null ? " · " + nf0.format(ws.pavg) + " g prot." : ""}</span><span class="m num" style="text-align:right">${ws.wavg != null ? nf1.format(ws.wavg) + " kg" + (dv != null ? " (" + (dv > 0 ? "+" : "") + nf1.format(dv) + ")" : "") : ""}${w2 && w2.waist != null ? " · " + nf1.format(w2.waist) + " cm" : ""}</span></button>`);
    m = addDays(m, -7);
  }
  h += `<div class="card"><h3>Historique</h3><div class="hist">${rows.join("")}</div><div class="muted" style="font-size:12.5px;margin-top:8px">Vert : jusqu'à +100 kcal de l'objectif. Orange : +100 à +300. Rouge : au-delà. Rythme visé : −0,25 à −0,5 kg par semaine sur le poids moyen.</div></div></div>`;
  return h;
}

function renderFoods() {
  const s = settings(), list = foodsList();
  let h = `<div class="title-row"><h1>Aliments et réglages</h1></div><div class="stack">
  <div class="card"><h3>Objectifs</h3>
    <div style="display:grid;gap:10px">
      <div class="field"><label for="goal-k">Calories / jour</label><span><input id="goal-k" class="num" inputmode="numeric" value="${s.kcalGoal}"> kcal</span></div>
      <div class="field"><label for="goal-p">Protéines / jour</label><span><input id="goal-p" class="num" inputmode="numeric" value="${s.protGoal}"> g</span></div>
    </div>
    <div class="muted" style="font-size:12.5px;margin-top:8px">Si ni le poids moyen ni le tour de taille ne bougent pendant 2 à 3 semaines, baisse d'environ 150 kcal.</div>
  </div>`;
  for (const gk of Object.keys(GROUPS)) {
    const items = list.filter(f => (f.groups || [])[0] === gk || (!(f.groups || []).length && gk === "sup"));
    if (!items.length) continue;
    h += `<div class="card"><h3>${GROUPS[gk]}</h3>${items.map(f => `<div class="frow">
      <input class="full" id="f-${f.id}-name" data-fid="${f.id}" data-f="name" value="${esc(f.name)}" aria-label="Nom">
      <input class="full" id="f-${f.id}-portion" data-fid="${f.id}" data-f="portion" value="${esc(f.portion)}" aria-label="Portion">
      <label class="pair"><input class="num" id="f-${f.id}-kcal" data-fid="${f.id}" data-f="kcal" inputmode="numeric" value="${f.kcal}"><span>kcal</span></label>
      <label class="pair"><input class="num" id="f-${f.id}-prot" data-fid="${f.id}" data-f="prot" inputmode="decimal" value="${f.prot}"><span>g prot.</span></label>
      <div class="acts">${S.confirmDel === f.id ? `<span class="muted" style="font-size:13px;margin-right:10px">Les jours passés perdront ces kcal.</span><button class="link-del" data-act="delFood" data-fid="${f.id}">Confirmer la suppression</button>` : `<button class="link-del" data-act="askDel" data-fid="${f.id}">Supprimer</button>`}</div>
    </div>`).join("")}</div>`;
  }
  h += `<div class="card"><h3>Ajouter un aliment</h3>
    <form data-form="food" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <input id="nf-name" style="grid-column:1/-1" placeholder="Nom (ex. Skyr)" autocomplete="off">
      <input id="nf-portion" style="grid-column:1/-1" placeholder="Portion (ex. 150 g)" autocomplete="off">
      <input id="nf-kcal" class="num" inputmode="numeric" placeholder="kcal / portion">
      <input id="nf-prot" class="num" inputmode="decimal" placeholder="g de protéines">
      <select id="nf-group" style="grid-column:1/-1" aria-label="Catégorie">${Object.entries(GROUPS).map(([k, v]) => `<option value="${k}">${v}${k === "prot" || k === "fec" || k === "acc" ? " (déjeuner et dîner)" : ""}</option>`).join("")}</select>
      <button class="btn" type="submit" style="grid-column:1/-1">Ajouter</button>
    </form></div>
  <div class="card"><h3>Sauvegarde</h3>
    <div class="muted" style="font-size:13px;margin-bottom:10px">Télécharge toutes tes données dans un fichier, ou réimporte un fichier exporté avant.</div>
    <div class="row-btns"><button class="btn ghost" data-act="export">Exporter (.json)</button><button class="btn ghost" data-act="import">Importer</button></div>
  </div>
  <div class="card"><h3>Compte</h3>
    <div class="muted" style="font-size:13px;margin-bottom:10px">Connecté : ${esc(S.user && S.user.email)}</div>
    <button class="btn ghost" data-act="logout">Se déconnecter</button>
  </div></div>`;
  return h;
}

function render() {
  if (!S.user) { tabsEl.hidden = true; view.innerHTML = renderLogin(); return; }
  tabsEl.hidden = false;
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-current", b.dataset.tab === S.tab ? "page" : "false"));
  view.innerHTML = S.tab === "jour" ? renderDay() : S.tab === "semaine" ? renderWeek() : renderFoods();
}

/* ---------------- interactions ---------------- */
tabsEl.addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (!b) return; S.tab = b.dataset.tab; S.confirmDel = null; render(); window.scrollTo(0, 0); });

view.addEventListener("click", async e => {
  const g = e.target.closest("[data-goto]"); if (g) { S.tab = g.dataset.goto; render(); return; }
  const t = e.target.closest("[data-act]"); if (!t) return;
  const a = t.dataset.act;
  if (a === "loginMode") { S.login.mode = S.login.mode === "in" ? "up" : "in"; S.login.err = S.login.info = ""; }
  else if (a === "prevDay") S.date = addDays(S.date, -1);
  else if (a === "nextDay") S.date = addDays(S.date, 1);
  else if (a === "today") S.date = todayStr();
  else if (a === "toggle" || a === "qty") {
    const day = cloneDay(getDay(S.date)), k = t.dataset.key;
    if (a === "toggle") { if (day.items[k]) delete day.items[k]; else day.items[k] = 1; }
    else day.items[k] = Number(t.dataset.q);
    save("days/" + S.date, day);
  }
  else if (a === "collapse") { const m = t.dataset.meal; S.collapsed[m] = !S.collapsed[m]; lsSet("recomp-collapsed", S.collapsed); }
  else if (a === "copyPrev") { const y = cloneDay(getDay(addDays(S.date, -1))); const cur = getDay(S.date); y.weight = cur && cur.weight != null ? cur.weight : null; save("days/" + S.date, y); toast("Journée de la veille copiée"); }
  else if (a === "delExtra") { const day = cloneDay(getDay(S.date)); day.extras.splice(Number(t.dataset.i), 1); save("days/" + S.date, day); }
  else if (a === "prevWeek") S.weekOf = addDays(S.weekOf, -7);
  else if (a === "nextWeek") S.weekOf = addDays(S.weekOf, 7);
  else if (a === "thisWeek") S.weekOf = monday(todayStr());
  else if (a === "gotoDay") { S.date = t.dataset.d; S.tab = "jour"; render(); window.scrollTo(0, 0); return; }
  else if (a === "gotoWeek") { S.weekOf = t.dataset.m; render(); window.scrollTo(0, 0); return; }
  else if (a === "askDel") S.confirmDel = t.dataset.fid;
  else if (a === "delFood") { S.confirmDel = null; save("foods/" + t.dataset.fid, null); toast("Aliment supprimé"); }
  else if (a === "export") { exportData(); return; }
  else if (a === "import") { document.getElementById("import-file").click(); return; }
  else if (a === "logout") { try { localStorage.removeItem("recomp-last-user"); } catch (_) {} await sb.auth.signOut(); return; }
  render();
});

view.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target.dataset.form;
  if (f === "login") {
    const email = document.getElementById("login-email").value.trim(), pass = document.getElementById("login-pass").value;
    S.login.busy = true; S.login.err = S.login.info = ""; render();
    try {
      if (S.login.mode === "up") {
        const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: location.href.split("#")[0] } });
        if (error) throw error;
        if (!data.session) { S.login.info = "Compte créé. Ouvre l'e-mail de confirmation, clique sur le lien, puis connecte-toi ici."; S.login.mode = "in"; }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      }
    } catch (err) {
      const m = String(err && err.message || "");
      S.login.err = /invalid login/i.test(m) ? "E-mail ou mot de passe incorrect."
        : /not confirmed/i.test(m) ? "Confirme d'abord ton e-mail avec le lien reçu."
        : /signups not allowed|signup is disabled/i.test(m) ? "La création de compte est désactivée sur cette appli."
        : /fetch|network/i.test(m) ? "Pas de connexion à internet. Réessaie quand tu es en ligne."
        : m || "Connexion impossible. Réessaie.";
    }
    S.login.busy = false; render();
  } else if (f === "extra") {
    const label = document.getElementById("extra-label").value.trim(), k = num(document.getElementById("extra-kcal").value);
    if (k == null || k <= 0) { toast("Indique les kcal de l'écart (un nombre)."); return; }
    const day = cloneDay(getDay(S.date)); day.extras.push({ label: label || "Écart", kcal: Math.round(k) });
    save("days/" + S.date, day); document.activeElement && document.activeElement.blur(); render();
  } else if (f === "food") {
    const name = document.getElementById("nf-name").value.trim(), portion = document.getElementById("nf-portion").value.trim();
    const k = num(document.getElementById("nf-kcal").value), p = num(document.getElementById("nf-prot").value), grp = document.getElementById("nf-group").value;
    if (!name || k == null) { toast("Donne au moins un nom et des kcal."); return; }
    const id = "f" + Date.now().toString(36);
    const order = Math.max(0, ...foodsList().map(x => x.order || 0)) + 1;
    save("foods/" + id, { name, portion: portion || "1 portion", kcal: k, prot: p || 0, groups: [grp], order });
    document.activeElement && document.activeElement.blur(); render(); toast("« " + name + " » ajouté");
  }
});

view.addEventListener("change", e => {
  const el = e.target;
  if (el.id === "weight") { const day = cloneDay(getDay(S.date)); const v = num(el.value); day.weight = v == null ? null : Math.round(v * 10) / 10; save("days/" + S.date, day); }
  else if (el.id === "waist") { const v = num(el.value); save("weeks/" + S.weekOf, { waist: v == null ? null : Math.round(v * 10) / 10 }); }
  else if (el.id === "goal-k" || el.id === "goal-p") {
    const s = settings(), v = num(el.value);
    if (v == null || v <= 0) { toast("Entre un nombre positif."); return; }
    if (el.id === "goal-k") s.kcalGoal = Math.round(v); else s.protGoal = Math.round(v);
    save("settings/main", s);
  } else if (el.dataset.fid) {
    const path = "foods/" + el.dataset.fid, cur = get(path); if (!cur) return;
    const f = Object.assign({}, cur), k = el.dataset.f;
    if (k === "kcal" || k === "prot") { const v = num(el.value); if (v == null) { toast("Entre un nombre."); return; } f[k] = v; } else f[k] = el.value.trim();
    save(path, f);
  }
});

function exportData() {
  const blob = new Blob([JSON.stringify({ app: "recomp", exportedAt: new Date().toISOString(), docs: S.docs }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "recomp-" + todayStr() + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
document.getElementById("import-file").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = ""; if (!file) return;
  try {
    const json = JSON.parse(await file.text()), docs = json && json.docs;
    if (!docs || typeof docs !== "object") throw new Error();
    let n = 0;
    for (const [p, d] of Object.entries(docs)) if (/^(foods|days|weeks|settings)\/[\w.-]+$/.test(p) && d && typeof d === "object") { save(p, d); n++; }
    render(); toast(n + " éléments importés");
  } catch (err) { toast("Ce fichier n'est pas une sauvegarde Recomp valide."); }
});

/* ---------------- démarrage ---------------- */
async function onSession(session) {
  const u = session && session.user;
  if (!u) {
    const last = lsGet("recomp-last-user", null);
    if (!navigator.onLine && last) {          // hors ligne : on garde l'accès aux données en cache
      S.user = last; S.docs = lsGet(cacheKey(), {}); S.queue = lsGet(queueKey(), {}); S.loaded = true; S.online = false;
      render(); return;
    }
    if (channel) { sb.removeChannel(channel); channel = null; }
    S.user = null; S.docs = {}; S.queue = {}; S.loaded = false; render(); return;
  }
  if (S.user && S.user.id === u.id) {      // même compte (jeton rafraîchi, retour en ligne…)
    await flush(); await pull(); if (!channel) subscribe(); return;
  }
  S.user = { id: u.id, email: u.email };
  lsSet("recomp-last-user", S.user);
  S.docs = lsGet(cacheKey(), {}); S.queue = lsGet(queueKey(), {});
  S.loaded = Object.keys(S.docs).length > 0;
  render();
  await flush(); await pull(); subscribe();
}

window.addEventListener("online", () => { S.online = true; flush().then(pull); });
window.addEventListener("offline", () => { S.online = false; renderSync(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.user) {
    if (S.date !== todayStr() && S.tab === "jour" && S._lastToday && S.date === S._lastToday) S.date = todayStr();
    flush().then(pull);
  }
  S._lastToday = todayStr();
});
S._lastToday = todayStr();
setInterval(() => { if (S.user && Object.keys(S.queue).length) flush(); }, 30000);

if (window.supabase && CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes("TON-PROJET")) {
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  sb.auth.getSession().then(({ data }) => onSession(data.session)).catch(() => onSession(null));
  // setTimeout : ne jamais appeler Supabase directement dans ce callback (risque de blocage)
  sb.auth.onAuthStateChange((_ev, session) => setTimeout(() => onSession(session), 0));
} else {
  render();
}
})();
