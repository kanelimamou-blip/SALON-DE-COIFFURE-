"use strict";
// Salon : file d'attente, catalogue des coupes et caisse pour les salons de coiffure hommes

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fcfa = (n) => Math.round(n || 0).toLocaleString("fr-FR").replace(/\s/g, " ") + " F";
const pad = (n) => String(n).padStart(2, "0");
const dayOf = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}h${pad(d.getMinutes())}`; };
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const monthLabel = (m) => { const [y, mo] = m.split("-"); return `${MOIS[+mo - 1]} ${y}`; };
const shiftMonth = (m, k) => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const uid = () => Math.random().toString(36).slice(2, 10);
const PAY = { cash: "Espèces", wave: "Wave", om: "Orange Money" };
const DEP_CATS = ["Loyer", "Électricité", "Produits", "Lames", "Eau", "Autre"];

// ---------- Ce téléphone : rôle, salon, tickets pris
const ME = (() => { try { return JSON.parse(localStorage.getItem("salon-me")) || {}; } catch (e) { return {}; } })();
const saveMe = () => { try { localStorage.setItem("salon-me", JSON.stringify(ME)); } catch (e) {} };
ME.tickets = ME.tickets || {};
ME.lang = ME.lang || "fr";
ME.pay = ME.pay || "cash";

// Écrans du client et écran d'attente en wolof (traduction à faire relire)
const WO = {
  "personnes avant toi": "nit ñu la jiitu",
  "personne avant toi": "nit ku la jiitu",
  "Attente estimée": "Diirub xaar",
  "Prendre mon ticket": "Jël sama ticket",
  "Ton prénom": "Sa tur",
  "Ton numéro (pour être prévenu)": "Sa nimero (ngir ñu xamal la)",
  "Choisis ta coupe": "Tannal sa coupe",
  "Coiffeur": "Coiffeur bi",
  "Peu importe": "Képp",
  "C'est ton tour !": "Sa tour agsi na !",
  "Présente-toi au salon.": "Ñëwal ci salon bi.",
  "Ton numéro": "Sa nimero",
  "Je ne viens plus": "Duma ñëw ankoo",
  "Me prévenir 10 minutes avant": "Xamal ma 10 minit balaa",
  "Viens vers": "Ñëwal ci",
  "Salon fermé pour le moment": "Salon bi dafa tëju léegi",
  "Merci et à bientôt !": "Jërëjëf, ba beneen yoon !",
  "Au fauteuil": "Ci fauteuil bi",
  "Suivants": "Ñi ci topp",
  "Scanne pour prendre ta place": "Scanne ngir jël sa place",
  "en attente": "di xaar",
  "Prix": "Njëg",
  "Nos réalisations": "Sunu liggéey",
  "min": "minit",
};
const t = (fr) => (ME.lang === "wo" && WO[fr]) || fr;

// ---------- Salon suivi en direct
const LIVE = { sid: null, salon: null, queue: [], ventes: [], depenses: [], stock: [], pointage: [], contacts: {}, subs: [] };
function follow(sid, role) {
  const key = sid + "|" + role;
  if (LIVE.key === key) return;
  LIVE.subs.forEach((f) => f && f());
  Object.assign(LIVE, { key, sid, salon: null, queue: [], ventes: [], depenses: [], stock: [], pointage: [], contacts: {}, subs: [] });
  const on = (k) => (v) => { LIVE[k] = v; refresh(); };
  const today = dayOf();
  LIVE.subs.push(Store.watchSalon(sid, (v) => { LIVE.salon = v; tabs(document.body.dataset.route); if (window.demoBar) demoBar(); refresh(); }));
  LIVE.subs.push(Store.watch(sid, "queue", [["day", "==", today]], on("queue")));
  LIVE.subs.push(Store.watch(sid, "pointage", [["day", "==", today]], on("pointage")));
  if (role === "patron") {
    const from = shiftMonth(today.slice(0, 7), -2) + "-01";
    LIVE.subs.push(Store.watch(sid, "ventes", [["day", ">=", from]], on("ventes")));
    LIVE.subs.push(Store.watch(sid, "depenses", [["day", ">=", from]], on("depenses")));
    LIVE.subs.push(Store.watch(sid, "stock", [], on("stock")));
  }
  if (role === "coiffeur") LIVE.subs.push(Store.watch(sid, "ventes", [["coiffeurId", "==", ME.coiffeurId]], on("ventes")));
  if (role === "patron" || role === "coiffeur") LIVE.subs.push(Store.watch(sid, "contacts", [["day", "==", today]], (rows) => { LIVE.contacts = Object.fromEntries(rows.map((r) => [r.id, r.phone])); refresh(); }));
}

const services = () => (LIVE.salon && LIVE.salon.services) || [];
const coiffeurs = () => (LIVE.salon && LIVE.salon.coiffeurs) || [];
const svcOf = (id) => services().find((s) => s.id === id) || { name: "Coupe", price: 0, dur: 20 };
const coifOf = (id) => coiffeurs().find((c) => c.id === id);
const isStaff = () => ME.role === "patron" || ME.role === "coiffeur";

// ---------- Salon suspendu par l'équipe de l'appli (espace admin) : le paiement de l'abonnement se fait hors de l'appli
const unlocked = (s) => !!s && !s.blocked;

// ---------- Attente estimée (idée 8) : chaque coiffeur présent prend le suivant, selon la durée des coupes
function present() {
  const here = LIVE.pointage.filter((p) => p.in && !p.out).map((p) => p.coiffeurId);
  const list = coiffeurs().filter((c) => here.includes(c.id));
  return list.length ? list : coiffeurs().length ? coiffeurs() : [{ id: "_" }];
}
// ordre : appelés, puis rendez-vous et coupes express (idée 41), puis par numéro
const prio = (e) => (e.status === "appele" ? 2 : 0) + (e.rdv || e.express ? 1 : 0);
const waiting = () => LIVE.queue.filter((e) => e.status === "attente" || e.status === "appele").sort((a, b) => prio(b) - prio(a) || a.num - b.num);
const inChair = () => LIVE.queue.filter((e) => e.status === "fauteuil").sort((a, b) => a.num - b.num);
function estimate() {
  const now = Date.now();
  const free = Object.fromEntries(present().map((c) => [c.id, 0]));
  inChair().forEach((e) => {
    const k = e.coiffeurId in free ? e.coiffeurId : Object.keys(free).sort((a, b) => free[a] - free[b])[0];
    free[k] = Math.max(free[k], 2, svcOf(e.serviceId).dur - (now - (e.startedAt || now)) / 6e4);
  });
  const out = {};
  waiting().forEach((e) => {
    const k = e.coiffeurId && e.coiffeurId in free ? e.coiffeurId : Object.keys(free).sort((a, b) => free[a] - free[b])[0];
    out[e.id] = Math.round(free[k]);
    free[k] += svcOf(e.serviceId).dur;
  });
  // pour un client qui arrive maintenant : le premier coiffeur libre
  out._next = Math.round(Math.min(...Object.values(free)));
  return out;
}
const waitLabel = (m) => m < 1 ? "maintenant" : m < 60 ? `${m} ${t("min")}` : `${Math.floor(m / 60)} h ${pad(m % 60)}`;

// ---------- Petits outils d'interface
let toastTimer = null;
function toast(msg, undo) {
  let el = $("#toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Annuler</button>' : ""}`;
  el.hidden = false;
  if (undo) el.querySelector("button").onclick = () => { undo(); el.hidden = true; };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, undo ? 5000 : 2500);
}
// Feuille qui monte du bas pour un choix rapide ; résout avec la valeur choisie ou null
function sheet(title, options) {
  return new Promise((ok) => {
    const el = document.createElement("div");
    el.className = "sheet-bg";
    el.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(title)}"><h3>${esc(title)}</h3><div class="sheet-opts">${options.map((o, i) => `<button type="button" class="btn ${o.cls || "alt"}" data-i="${i}">${o.html || esc(o.label)}</button>`).join("")}</div><button type="button" class="btn-ghost" data-x>Fermer</button></div>`;
    document.body.appendChild(el);
    const close = (v) => { el.remove(); ok(v); };
    el.onclick = (e) => { const b = e.target.closest("button"); if (e.target === el || (b && b.dataset.x !== undefined)) return close(null); if (b) close(options[+b.dataset.i].value); };
    el.querySelector("button").focus();
  });
}
// Photo réduite en JPEG léger (peu de données mobiles)
function shrink(file, max = 480, q = 0.62) {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src); ok(c.toDataURL("image/jpeg", q));
    };
    img.onerror = ko; img.src = URL.createObjectURL(file);
  });
}
function qrSvg(text, size = 220) {
  const q = qrcode(0, "M"); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 2, s = n + m * 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`;
  return `<svg class="qr" viewBox="0 0 ${s} ${s}" width="${size}" height="${size}" role="img" aria-label="QR code"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
const baseUrl = () => location.href.split("#")[0];
const ticketUrl = (sid) => `${baseUrl()}#ticket/${sid}`;
const svcThumb = (s, cls = "thumb") => s.photo ? `<img class="${cls}" src="${s.photo}" alt="">` : `<span class="${cls} ph" aria-hidden="true">${esc((s.name || "?").slice(0, 2))}</span>`;
const waLink = (phone, text) => `https://wa.me/${("221" + String(phone).replace(/\D/g, "").replace(/^221/, ""))}?text=${encodeURIComponent(text)}`;

// ---------- Navigation
const $view = $("#view");
let refreshFn = null;
let idle = null;
let viewSubs = [];
function refresh() { if (refreshFn) { const a = document.activeElement; if (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && a.closest("[data-keep]")) return; refreshFn(); } }
function go(h) { if (location.hash === "#" + h) render(); else location.hash = h; }
const ROUTES = {};
const STAFF_ROUTES = ["file", "rdv", "caisse", "bilan", "salon", "pointage", "clients", "offres"];
function render() {
  const [r, arg] = location.hash.slice(1).split("/");
  refreshFn = null; clearInterval(idle); idle = null;
  viewSubs.forEach((f) => f()); viewSubs = [];
  $view.onclick = null;
  document.body.dataset.route = r || "accueil";
  releaseWake();
  let route = ROUTES[r] ? r : "accueil";
  if (STAFF_ROUTES.includes(route) && !(isStaff() && ME.sid)) route = "accueil";
  if (["bilan", "salon", "clients", "offres"].includes(route) && ME.role !== "patron") route = "file";
  if (isStaff() && ME.sid) follow(ME.sid, ME.role);
  tabs(route);
  if (window.demoBar) demoBar();
  $("#adm-link").hidden = !(typeof isAdmin === "function" && isAdmin()) || route === "admin";
  ROUTES[route](arg ? decodeURIComponent(arg) : "");
  $view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", render);

function tabs(route) {
  const nav = $("#tabs");
  nav.hidden = !(isStaff() && STAFF_ROUTES.includes(route));
  if (nav.hidden) return;
  const T = { file: ["File", "M4 6h16M4 12h16M4 18h10"], rdv: ["RDV", "M4 5h16v15H4zM4 10h16M9 3v4M15 3v4"], caisse: ["Caisse", "M3 7h18v12H3zM3 11h18M7 15h3"], bilan: ["Bilan", "M4 20V10M10 20V4M16 20v-7M22 20H2"],
    clients: ["Clients", "M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8M2 21v-1a7 7 0 0 1 14 0v1M17 11a3 3 0 1 0 0-6M22 21v-1a5 5 0 0 0-4-5"], salon: ["Salon", "M12 3l9 7v11H3V10zM9 21v-6h6v6"], pointage: ["Pointage", "M12 7v5l3 2M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18"] };
  const simple = LIVE.salon && LIVE.salon.simple;
  const keys = ME.role === "patron" ? (simple ? ["caisse", "bilan", "clients", "salon"] : ["file", "rdv", "caisse", "bilan", "salon"]) : ["file", "rdv", "caisse", "pointage"];
  const items = keys.map((k) => [k, k === "caisse" && ME.role === "coiffeur" ? "Mes coupes" : T[k][0], T[k][1]]);
  const low = ME.role === "patron" ? LIVE.stock.filter((s) => s.qty <= (s.min || 0)).length : 0;
  nav.innerHTML = items.map(([h, l, d]) => `<a href="#${h}"${route === h || (h === "salon" && route === "offres") || (h === "clients" && route === "clients") ? ' aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg><span>${l}</span>${h === "salon" && low ? `<i class="badge">${low}</i>` : ""}</a>`).join("");
}

// ---------- Accueil : choisir son rôle
ROUTES.accueil = () => {
  // le propriétaire de l'appli arrive directement sur son espace admin
  if (typeof isAdmin === "function" && isAdmin() && !ME.role) return go("admin");
  if (ME.role === "client" && ME.sid) return go("ticket/" + ME.sid);
  if (isStaff() && ME.sid) return go("file");
  if (ME.role === "client" && !ME.sid) ME.role = null;
  $view.innerHTML = `
    <section class="hero">
      <div class="pole" aria-hidden="true"></div>
      <h1>La file d'attente, les coupes et la caisse du salon, sur le téléphone.</h1>
      <p class="muted">Le client sait quand c'est son tour. Le patron sait combien rapporte chaque coiffeur.</p>
    </section>
    <div class="stack">
      <a class="role" href="#demarrer"><b>Je suis le patron</b><span>Créer mon salon en une minute</span></a>
      <a class="role" href="#rejoindre"><b>Je suis coiffeur</b><span>Rejoindre le salon avec le code du patron</span></a>
      <form class="role role-form" id="cli" data-keep>
        <label for="cli-code"><b>Je suis client</b><span>Entre le code du salon ou scanne son QR code</span></label>
        <div class="row"><input class="field" id="cli-code" maxlength="5" placeholder="Code (ex. K7P2Q)" autocapitalize="characters" autocomplete="off"><button class="btn">Entrer</button></div>
      </form>
    </div>
    <a class="role" href="#annuaire"><b>Trouver un salon</b><span>Les salons du quartier, l'attente en direct et les prix</span></a>
    <form class="role role-form" id="scr" data-keep>
      <label for="scr-code"><b>Écran d'attente</b><span>Pour un vieux téléphone ou une télé laissés allumés dans le salon</span></label>
      <div class="row"><input class="field" id="scr-code" maxlength="5" placeholder="Code du salon" autocapitalize="characters" autocomplete="off"><button class="btn alt">Afficher</button></div>
    </form>
    <p class="small" style="text-align:center"><a class="muted" href="#admin">Espace propriétaire de l'appli</a></p>`;
  $("#cli").onsubmit = (e) => { e.preventDefault(); const c = $("#cli-code").value.trim().toUpperCase(); if (c.length >= 4) go("ticket/" + c); };
  $("#scr").onsubmit = (e) => { e.preventDefault(); const c = $("#scr-code").value.trim().toUpperCase(); if (c.length >= 4) go("ecran/" + c); };
};

// ---------- Patron : connexion puis création du salon
ROUTES.demarrer = async () => {
  if (!Store.isAccount()) {
    $view.innerHTML = `<h1>Mon compte patron</h1>
      <div class="card"><p>Ton compte garde les chiffres du salon, même si tu changes de téléphone.</p>
        <button class="btn" id="g" type="button">Continuer avec Google</button></div>
      <form class="card" id="em" data-keep><h2>Ou avec un e-mail</h2>
        <input class="field" id="em-mail" type="email" placeholder="E-mail" autocomplete="email" required>
        <input class="field" id="em-pass" type="password" placeholder="Mot de passe (6 caractères ou plus)" minlength="6" autocomplete="current-password" required>
        <div class="row"><button class="btn" data-a="in">Se connecter</button><button class="btn alt" data-a="new">Créer le compte</button></div>
        <p class="small" id="em-msg"></p></form>`;
    $("#g").onclick = () => Store.signIn().then(render, (e) => toast("Connexion impossible : " + (e.code || e.message)));
    let mode = "in";
    $$("#em button").forEach((b) => (b.onclick = () => { mode = b.dataset.a; }));
    $("#em").onsubmit = (e) => { e.preventDefault(); $("#em-msg").textContent = "…";
      Store.signInEmail($("#em-mail").value.trim(), $("#em-pass").value, mode === "new").then(render, (er) => { $("#em-msg").className = "small msg-ko"; $("#em-msg").textContent = /wrong-password|invalid-cred|user-not-found/.test(er.code) ? "E-mail ou mot de passe incorrect." : /email-already/.test(er.code) ? "Ce compte existe déjà : appuie sur Se connecter." : "Connexion impossible. Vérifie le réseau."; }); };
    return;
  }
  // le propriétaire de l'appli qui vient de se connecter va sur son espace admin
  if (typeof isAdmin === "function" && isAdmin()) return go("admin");
  const mine = await Store.mySalons().catch(() => []);
  $view.innerHTML = `<h1>Mon salon</h1>
    ${mine.length ? `<div class="card"><h2>Mes salons</h2>${mine.map((s) => `<button class="line-btn" data-sid="${esc(s.id)}" type="button"><b>${esc(s.name)}</b><span class="muted small">${esc(s.quartier || "")} · code ${esc(s.id)}</span></button>`).join("")}</div>` : ""}
    <form class="card" id="new" data-keep><h2>${mine.length ? "Ajouter un salon" : "Créer mon salon"}</h2>
      <label class="lbl" for="n-name">Nom du salon</label><input class="field" id="n-name" required maxlength="40" placeholder="Ex. Salon Teranga">
      <label class="lbl" for="n-q">Quartier et ville</label><input class="field" id="n-q" maxlength="50" placeholder="Ex. Médina, Dakar">
      <label class="lbl" for="n-tel">Numéro WhatsApp du salon</label><input class="field" id="n-tel" inputmode="tel" maxlength="20" placeholder="Ex. 77 123 45 67">
      <label class="lbl" for="n-coif">Prénoms des coiffeurs (séparés par des virgules)</label><input class="field" id="n-coif" maxlength="120" placeholder="Ex. Modou, Ibou, Pape">
      <button class="btn">Créer le salon</button></form>`;
  $$("[data-sid]").forEach((b) => (b.onclick = () => { Object.assign(ME, { role: "patron", sid: b.dataset.sid }); saveMe(); go("file"); }));
  $("#new").onsubmit = async (e) => {
    e.preventDefault();
    const names = $("#n-coif").value.split(",").map((s) => s.trim()).filter(Boolean);
    const data = { name: $("#n-name").value.trim(), quartier: $("#n-q").value.trim(), tel: $("#n-tel").value.trim(), open: true,
      services: defaultServices(), coiffeurs: (names.length ? names : ["Patron"]).map((n) => ({ id: uid(), name: n, pct: 40 })) };
    try { const sid = await Store.createSalon(data); Object.assign(ME, { role: "patron", sid }); saveMe(); toast("Salon créé"); go("salon"); }
    catch (er) { toast("Création impossible. Vérifie le réseau."); }
  };
};
const defaultServices = () => [
  ["Dégradé", 1500, 25], ["Boule à zéro", 1000, 15], ["Barbe", 500, 10], ["Coupe et barbe", 2000, 35], ["Teinture", 2500, 40], ["Coupe enfant", 1000, 20],
].map(([name, price, dur]) => ({ id: uid(), name, price, dur, photo: "" }));

// ---------- Coiffeur : relier son téléphone au salon
ROUTES.rejoindre = () => {
  $view.innerHTML = `<h1>Rejoindre mon salon</h1>
    <form class="card" id="j" data-keep>
      <p class="small muted">Demande au patron le code du salon et le code coiffeur (dans Salon, rubrique Coiffeurs).</p>
      <label class="lbl" for="j-sid">Code du salon</label><input class="field" id="j-sid" maxlength="5" autocapitalize="characters" required placeholder="Ex. K7P2Q">
      <label class="lbl" for="j-code">Code coiffeur</label><input class="field" id="j-code" maxlength="4" autocapitalize="characters" required placeholder="Ex. 4XRT">
      <button class="btn">Continuer</button><p class="small" id="j-msg"></p></form><div id="j-who"></div>`;
  $("#j").onsubmit = async (e) => {
    e.preventDefault();
    const sid = $("#j-sid").value.trim().toUpperCase(), code = $("#j-code").value.trim().toUpperCase();
    await Store.ensureUser().catch(() => {});
    const s = await Store.getSalon(sid).catch(() => null);
    if (!s) { $("#j-msg").className = "small msg-ko"; $("#j-msg").textContent = "Ce code de salon n'existe pas."; return; }
    $("#j-who").innerHTML = `<div class="card"><h2>Qui es-tu ?</h2><div class="chips">${s.coiffeurs.map((c) => `<button class="chip" type="button" data-c="${esc(c.id)}">${esc(c.name)}</button>`).join("")}</div></div>`;
    $$("#j-who [data-c]").forEach((b) => (b.onclick = () => Store.joinStaff(sid, code, b.dataset.c).then(() => {
      Object.assign(ME, { role: "coiffeur", sid, coiffeurId: b.dataset.c }); saveMe(); toast("Bienvenue " + b.textContent); go("file");
    }, () => { $("#j-msg").className = "small msg-ko"; $("#j-msg").textContent = "Le code coiffeur ne correspond pas."; })));
  };
};

// ---------- File d'attente (patron et coiffeurs)
ROUTES.file = () => {
  if (ME.role === "patron" && LIVE.salon && LIVE.salon.simple) return go("caisse");
  $view.innerHTML = `<div id="f-head"></div>
    <details class="card add" id="f-add-box"><summary>Ajouter un client arrivé au salon</summary>
      <form id="f-add" data-keep>
        <input class="field" id="a-name" maxlength="30" placeholder="Prénom du client" required>
        <div class="row"><select class="field" id="a-svc" aria-label="Coupe"></select><select class="field" id="a-coif" aria-label="Coiffeur"></select></div>
        <button class="btn">Donner un ticket</button></form></details>
    <section><h2 class="sec">${t("Au fauteuil")}</h2><div id="f-chair" class="list"></div></section>
    <section><h2 class="sec">En attente</h2><div id="f-wait" class="list"></div></section>
    <section><h2 class="sec">Terminés aujourd'hui</h2><div id="f-done" class="list"></div></section>
    <div class="row links"><a class="btn alt" href="#ecran/${esc(ME.sid)}">Écran d'attente</a><a class="btn alt" href="#page/${esc(ME.sid)}">Page du salon</a></div>
    <input type="file" accept="image/*" hidden id="f-photo">`;
  const fillSelects = () => {
    $("#a-svc").innerHTML = services().map((s) => `<option value="${esc(s.id)}">${esc(s.name)} · ${fcfa(s.price)}</option>`).join("");
    $("#a-coif").innerHTML = `<option value="">Coiffeur : peu importe</option>` + coiffeurs().map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  };
  $("#f-add").onsubmit = async (e) => {
    e.preventDefault();
    const name = $("#a-name").value.trim(); if (!name) return;
    const num = await Store.nextNumber(ME.sid, dayOf());
    await Store.add(ME.sid, "queue", { day: dayOf(), num, name, serviceId: $("#a-svc").value, coiffeurId: $("#a-coif").value || null, status: "attente", at: Date.now(), uid: Store.uid, walkin: true });
    $("#a-name").value = ""; $("#f-add-box").open = false; toast(`Ticket n° ${num} pour ${name}`);
  };
  refreshFn = () => {
    const s = LIVE.salon; if (!s) { $("#f-head").innerHTML = `<p class="muted">Chargement…</p>`; return; }
    if (ME.role === "patron" && s.simple) return go("caisse");
    if (!$("#a-svc").options.length) fillSelects();
    const est = estimate(), w = waiting(), last = est._next;
    $("#f-head").innerHTML = `<div class="head-row"><div><h1>${esc(s.name)}</h1><p class="muted small">Code du salon <b class="code">${esc(s.id)}</b></p></div>
      ${ME.role === "patron" ? `<button type="button" class="open-tog ${s.open ? "on" : ""}" id="tog" aria-pressed="${!!s.open}">${s.open ? "Ouvert" : "Fermé"}</button>` : `<span class="open-tog ${s.open ? "on" : ""}">${s.open ? "Ouvert" : "Fermé"}</span>`}</div>
      <div class="kpis"><div><b>${w.length}</b><span>en attente</span></div><div><b>${waitLabel(last)}</b><span>pour un nouveau client</span></div><div><b>${present().filter((c) => c.id !== "_").length}</b><span>coiffeurs présents</span></div></div>`;
    const tog = $("#tog"); if (tog) tog.onclick = () => Store.updateSalon(ME.sid, { open: !s.open });
    const row = (e, extra) => {
      const sv = svcOf(e.serviceId), c = coifOf(e.coiffeurId), phone = LIVE.contacts[e.id];
      return `<div class="q-item st-${e.status}" data-id="${esc(e.id)}"><span class="num">${e.num}</span>
        <div class="q-main"><b>${esc(e.name)}${e.rdv ? ` <span class="pill">RDV</span>` : ""}${e.express ? ` <span class="pill">Express</span>` : ""}</b><span class="small muted">${esc(sv.name)}${c ? " · " + esc(c.name) : ""}${e.walkin ? "" : " · ticket à distance"}</span>${extra || ""}</div>
        <div class="q-act">${actions(e, phone)}</div></div>`;
    };
    const actions = (e, phone) => {
      if (e.status === "fauteuil") return `<button class="btn sm" data-a="fini" type="button">Terminé</button>`;
      if (e.status === "parti") return "";
      if (e.status === "fini") return `<button class="btn-ghost sm" data-a="photo" type="button">${e.photo ? "Changer la photo" : "Photo"}</button>`;
      return `${e.status === "attente" ? `<button class="btn sm alt" data-a="appel" type="button">Appeler</button>` : ""}<button class="btn sm" data-a="chair" type="button">Au fauteuil</button>
        <button class="btn-ghost sm" data-a="parti" type="button" aria-label="Le client est parti">Parti</button>
        ${phone ? `<a class="btn-ghost sm" target="_blank" rel="noopener" href="${waLink(phone, `Bonjour ${e.name}, ici ${s.name}. Ton tour arrive dans 10 minutes (ticket n° ${e.num}).`)}">WhatsApp</a>` : ""}`;
    };
    const ch = inChair();
    $("#f-chair").innerHTML = ch.length ? ch.map((e) => row(e, `<span class="small">depuis ${Math.round((Date.now() - e.startedAt) / 6e4)} min</span>`)).join("") : `<p class="empty">Personne au fauteuil.</p>`;
    $("#f-wait").innerHTML = w.length ? w.map((e) => row(e, `<span class="small ${e.status === "appele" ? "hi" : ""}">${e.status === "appele" ? "Appelé, il arrive" : "Passage vers " + hm(Date.now() + est[e.id] * 6e4)}</span>`)).join("") : `<p class="empty">Personne n'attend. Les clients prennent un ticket avec le QR code du salon.</p>`;
    const done = LIVE.queue.filter((e) => e.status === "fini" || e.status === "parti").sort((a, b) => b.num - a.num);
    $("#f-done").innerHTML = done.length ? done.slice(0, 12).map((e) => row(e, `<span class="small muted">${e.status === "fini" ? "Coupé" : "Parti sans coupe"}</span>`)).join("") : `<p class="empty">Rien pour le moment.</p>`;
  };
  $view.onclick = async (ev) => {
    const b = ev.target.closest("button[data-a]"); if (!b) return;
    const e = LIVE.queue.find((x) => x.id === b.closest("[data-id]").dataset.id); if (!e) return;
    const a = b.dataset.a;
    // photo avant / après envoyée dans l'historique du client (idée 48)
    if (a === "photo") { const inp = $("#f-photo"); inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const img = await shrink(f, 480, 0.6); Store.update(ME.sid, "queue", e.id, { photo: img }); if (LIVE.contacts[e.id]) saveClientPhoto(LIVE.contacts[e.id], img); inp.value = ""; toast("Photo ajoutée à l'historique du client"); }; inp.click(); return; }
    if (a === "appel") Store.update(ME.sid, "queue", e.id, { status: "appele", calledAt: Date.now() });
    if (a === "parti") { Store.update(ME.sid, "queue", e.id, { status: "parti" }); toast(`N° ${e.num} retiré de la file`, () => Store.update(ME.sid, "queue", e.id, { status: "attente" })); }
    if (a === "chair") {
      let c = ME.role === "coiffeur" ? ME.coiffeurId : e.coiffeurId;
      if (!c && coiffeurs().length > 1) c = await sheet(`Qui coiffe ${e.name} ?`, present().filter((x) => x.id !== "_").concat(coiffeurs().filter((x) => !present().includes(x))).map((x) => ({ label: x.name, value: x.id })));
      if (!c && coiffeurs().length === 1) c = coiffeurs()[0].id;
      if (!c) return;
      Store.update(ME.sid, "queue", e.id, { status: "fauteuil", coiffeurId: c, startedAt: Date.now() });
    }
    if (a === "fini") {
      const sv = svcOf(e.serviceId);
      const pay = await sheet(`${e.name} · ${sv.name} · ${fcfa(sv.price)} : payé comment ?`, Object.entries(PAY).map(([k, l]) => ({ label: l, value: k, cls: k === "cash" ? "" : "alt" })).concat([{ label: "Pas encaissé", value: "none", cls: "btn-ghost" }]));
      if (!pay) return;
      Store.update(ME.sid, "queue", e.id, { status: "fini", endedAt: Date.now() });
      if (LIVE.contacts[e.id]) saveClient(LIVE.contacts[e.id], e.name, sv.name);
      if (pay !== "none") {
        const vid = await addVente(sv, e.coiffeurId, pay, e.id);
        toast(`${fcfa(sv.price)} encaissés (${PAY[pay]})`, () => { Store.remove(ME.sid, "ventes", vid); Store.update(ME.sid, "queue", e.id, { status: "fauteuil" }); });
      }
    }
  };
  idle = setInterval(refresh, 30000);
  refresh();
};
function addVente(sv, coiffeurId, pay, ticketId) {
  return Store.add(ME.sid, "ventes", { day: dayOf(), at: Date.now(), serviceId: sv.id, name: sv.name, price: sv.price, coiffeurId: coiffeurId || null, pay, by: Store.uid, ticketId: ticketId || null });
}

// ---------- Écran d'un salon suspendu
function locked(what) {
  $view.innerHTML = `<h1>${esc(what)}</h1><div class="card lock"><p>Ce salon est suspendu. Contacte l'équipe de l'appli au ${CFG.contact}.</p></div>`;
}

// ---------- Caisse (idées 11, 12, 13)
ROUTES.caisse = () => {
  $view.innerHTML = `<p class="muted">Chargement…</p>`;
  let built = false;
  refreshFn = () => {
    const s = LIVE.salon; if (!s) return;
    if (!unlocked(s)) return locked("Caisse");
    const mine = ME.role === "coiffeur";
    if (!built) {
      built = true;
      ME.coif = mine ? ME.coiffeurId : coifOf(ME.coif) ? ME.coif : (coiffeurs()[0] || {}).id;
      $view.innerHTML = `<h1>${mine ? "Mes coupes" : "Caisse du jour"}</h1>
        ${mine ? "" : `<div class="pick"><span class="lbl">Coiffeur</span><div class="chips" id="c-coif"></div></div>`}
        <div class="pick"><span class="lbl">Paiement</span><div class="chips" id="c-pay">${Object.entries(PAY).map(([k, l]) => `<button type="button" class="chip pay-${k}" data-p="${k}">${l}</button>`).join("")}</div></div>
        <p class="small muted">Touche une coupe pour l'encaisser.</p>
        <div class="svc-grid" id="c-svc"></div>
        <div id="c-tot"></div>
        <section><h2 class="sec">Encaissé aujourd'hui</h2><div id="c-list" class="list"></div></section>`;
      $("#c-pay").onclick = (e) => { const b = e.target.closest("[data-p]"); if (b) { ME.pay = b.dataset.p; saveMe(); refresh(); } };
      if (!mine) $("#c-coif").onclick = (e) => { const b = e.target.closest("[data-c]"); if (b) { ME.coif = b.dataset.c; saveMe(); refresh(); } };
      $("#c-svc").onclick = async (e) => {
        const b = e.target.closest("[data-s]"); if (!b) return;
        const sv = svcOf(b.dataset.s);
        b.classList.add("hit"); setTimeout(() => b.classList.remove("hit"), 400);
        const id = await addVente(sv, ME.coif, ME.pay);
        toast(`${sv.name} · ${fcfa(sv.price)} · ${PAY[ME.pay]}`, () => Store.remove(ME.sid, "ventes", id));
      };
      $("#c-list").onclick = (e) => { const b = e.target.closest("[data-del]"); if (!b) return; const v = LIVE.ventes.find((x) => x.id === b.dataset.del); Store.remove(ME.sid, "ventes", v.id); toast("Vente supprimée", () => Store.set(ME.sid, "ventes", v.id, (({ id, ...o }) => o)(v))); };
    }
    if (!mine) $("#c-coif").innerHTML = coiffeurs().map((c) => `<button type="button" class="chip" data-c="${esc(c.id)}" aria-pressed="${ME.coif === c.id}">${esc(c.name)}</button>`).join("");
    $$("#c-pay [data-p]").forEach((b) => b.setAttribute("aria-pressed", ME.pay === b.dataset.p));
    $("#c-svc").innerHTML = services().map((sv) => `<button type="button" class="svc" data-s="${esc(sv.id)}">${sv.photo ? svcThumb(sv) : ""}<b>${esc(sv.name)}</b><span>${fcfa(sv.price)}</span></button>`).join("");
    const today = dayOf(), month = today.slice(0, 7);
    const V = LIVE.ventes.filter((v) => !mine || v.coiffeurId === ME.coiffeurId);
    const td = V.filter((v) => v.day === today).sort((a, b) => b.at - a.at), mo = V.filter((v) => v.day.startsWith(month));
    const sum = (a) => a.reduce((x, v) => x + (v.price || 0), 0);
    const me = coifOf(ME.coiffeurId);
    $("#c-tot").innerHTML = `<div class="kpis big"><div><b>${fcfa(sum(td))}</b><span>aujourd'hui · ${td.length} coupe${td.length > 1 ? "s" : ""}</span></div><div><b>${fcfa(sum(mo))}</b><span>en ${MOIS[+month.slice(5) - 1]}</span></div>
      ${mine && me ? `<div><b>${fcfa(sum(mo) * (me.pct || 0) / 100)}</b><span>ma part du mois (${me.pct} %)</span></div>` : ""}</div>
      ${mine ? "" : `<div class="pay-split">${Object.entries(PAY).map(([k, l]) => `<span class="pay-${k}"><i></i>${l} <b>${fcfa(sum(td.filter((v) => v.pay === k)))}</b></span>`).join("")}</div>`}`;
    $("#c-list").innerHTML = td.length ? td.map((v) => `<div class="v-item"><span class="small muted tab">${hm(v.at)}</span><div class="q-main"><b>${esc(v.name)}</b><span class="small muted">${esc((coifOf(v.coiffeurId) || {}).name || "")} · ${PAY[v.pay] || ""}</span></div><b class="tab">${fcfa(v.price)}</b>${mine && v.by !== Store.uid ? "" : `<button type="button" class="btn-ghost sm" data-del="${esc(v.id)}" aria-label="Supprimer">✕</button>`}</div>`).join("") : `<p class="empty">Aucune coupe encaissée aujourd'hui.</p>`;
  };
  refresh();
};

// ---------- Pointage des coiffeurs (idée 17)
function pointageHtml(list) {
  const today = dayOf();
  return list.map((c) => {
    const p = LIVE.pointage.find((x) => x.coiffeurId === c.id) || {};
    return `<div class="v-item"><div class="q-main"><b>${esc(c.name)}</b><span class="small muted">${p.in ? "Arrivé à " + hm(p.in) : "Pas encore arrivé"}${p.out ? " · parti à " + hm(p.out) : ""}</span></div>
      ${!p.in ? `<button type="button" class="btn sm" data-in="${esc(c.id)}">Arrivé</button>` : !p.out ? `<button type="button" class="btn sm alt" data-out="${esc(c.id)}">Parti</button>` : `<span class="small muted">Journée finie</span>`}</div>`;
  }).join("") + `<input type="hidden" value="${today}">`;
}
function bindPointage(root) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-in],[data-out]"); if (!b) return;
    const day = dayOf();
    if (b.dataset.in) Store.set(ME.sid, "pointage", day + "_" + b.dataset.in, { day, coiffeurId: b.dataset.in, in: Date.now(), out: null });
    else { const id = day + "_" + b.dataset.out; Store.update(ME.sid, "pointage", id, { out: Date.now() }); }
  });
}
ROUTES.pointage = () => {
  $view.innerHTML = `<h1>Pointage</h1><p class="muted">Note ton arrivée et ton départ. Les clients voient l'attente selon les coiffeurs présents.</p><div class="card" id="p-list"></div>
    <div class="card"><p class="small muted">Ce téléphone est relié au salon comme coiffeur.</p><button class="btn-ghost" id="quit" type="button">Quitter le salon sur ce téléphone</button></div>`;
  bindPointage($("#p-list"));
  $("#quit").onclick = () => { Object.assign(ME, { role: null, sid: null, coiffeurId: null }); saveMe(); go("accueil"); };
  refreshFn = () => { const c = coifOf(ME.coiffeurId); $("#p-list").innerHTML = c ? pointageHtml([c]) : `<p class="muted">Chargement…</p>`; };
  refresh();
};

// ---------- Bilan du patron (idées 13, 14, 15)
ROUTES.bilan = (arg) => {
  const month = /^\d{4}-\d\d$/.test(arg) ? arg : dayOf().slice(0, 7);
  $view.innerHTML = `<p class="muted">Chargement…</p>`;
  let built = false;
  refreshFn = () => {
    const s = LIVE.salon; if (!s) return;
    if (!unlocked(s)) return locked("Bilan");
    if (!built) {
      built = true;
      const next = shiftMonth(month, 1), cur = dayOf().slice(0, 7);
      $view.innerHTML = `<div class="head-row"><h1>Bilan de ${monthLabel(month)}</h1></div>
        <div class="row month-nav"><a class="btn-ghost sm" href="#bilan/${shiftMonth(month, -1)}">← ${monthLabel(shiftMonth(month, -1))}</a>${next <= cur ? `<a class="btn-ghost sm" href="#bilan/${next}">${monthLabel(next)} →</a>` : ""}</div>
        <div id="b-kpi"></div>
        <section class="card"><h2>Recette et dépenses par jour</h2><div id="b-chart" class="chart"></div></section>
        <section class="card"><h2>Par coiffeur</h2><div class="tbl-wrap"><table class="tbl" id="b-coif"></table></div><p class="small muted">La part est calculée avec la commission de chaque coiffeur (Salon, rubrique Coiffeurs).</p></section>
        <section class="card"><h2>Dépenses</h2>
          <form id="d-add" class="dep-form" data-keep>
            <select class="field" id="d-cat" aria-label="Type de dépense">${DEP_CATS.map((c) => `<option>${c}</option>`).join("")}</select>
            <input class="field" id="d-amt" inputmode="numeric" placeholder="Montant (F)" required pattern="[0-9 ]+">
            <input class="field" id="d-note" maxlength="40" placeholder="Note (facultatif)">
            <input class="field" id="d-day" type="date" value="${month === cur ? dayOf() : month + "-01"}" aria-label="Date">
            <button class="btn">Ajouter la dépense</button></form>
          <div id="d-list" class="list"></div></section>`;
      $("#d-add").onsubmit = (e) => {
        e.preventDefault();
        const amount = +$("#d-amt").value.replace(/\D/g, ""); if (!amount) return;
        Store.add(ME.sid, "depenses", { day: $("#d-day").value || dayOf(), at: Date.now(), cat: $("#d-cat").value, amount, note: $("#d-note").value.trim() });
        $("#d-amt").value = ""; $("#d-note").value = ""; toast("Dépense ajoutée");
      };
      $("#d-list").onclick = (e) => { const b = e.target.closest("[data-del]"); if (b) Store.remove(ME.sid, "depenses", b.dataset.del); };
    }
    const V = LIVE.ventes.filter((v) => v.day.startsWith(month)), D = LIVE.depenses.filter((d) => d.day.startsWith(month));
    const rec = V.reduce((x, v) => x + v.price, 0), dep = D.reduce((x, d) => x + d.amount, 0);
    const parts = coiffeurs().map((c) => { const r = V.filter((v) => v.coiffeurId === c.id).reduce((x, v) => x + v.price, 0); return { c, n: V.filter((v) => v.coiffeurId === c.id).length, r, part: r * (c.pct || 0) / 100 }; });
    const comm = parts.reduce((x, p) => x + p.part, 0), ben = rec - comm - dep;
    $("#b-kpi").innerHTML = `<div class="kpis big"><div><b>${fcfa(rec)}</b><span>recette · ${V.length} coupes</span></div><div><b>${fcfa(comm)}</b><span>parts des coiffeurs</span></div><div><b>${fcfa(dep)}</b><span>dépenses</span></div>
      <div class="${ben >= 0 ? "pos" : "neg"}"><b>${fcfa(ben)}</b><span>bénéfice du salon</span></div></div>`;
    $("#b-chart").innerHTML = chart(month, V, D);
    $("#b-coif").innerHTML = `<thead><tr><th>Coiffeur</th><th>Coupes</th><th>Recette</th><th>Sa part</th><th>Pour le salon</th></tr></thead><tbody>${parts.map((p) => `<tr><td>${esc(p.c.name)} <span class="muted small">${p.c.pct} %</span></td><td>${p.n}</td><td>${fcfa(p.r)}</td><td>${fcfa(p.part)}</td><td>${fcfa(p.r - p.part)}</td></tr>`).join("")}</tbody>`;
    $("#d-list").innerHTML = D.length ? D.sort((a, b) => b.day.localeCompare(a.day) || b.at - a.at).map((d) => `<div class="v-item"><span class="small muted tab">${d.day.slice(8)}/${d.day.slice(5, 7)}</span><div class="q-main"><b>${esc(d.cat)}</b><span class="small muted">${esc(d.note || "")}</span></div><b class="tab">${fcfa(d.amount)}</b><button type="button" class="btn-ghost sm" data-del="${esc(d.id)}" aria-label="Supprimer">✕</button></div>`).join("") : `<p class="empty">Aucune dépense ce mois-ci.</p>`;
  };
  refresh();
};
// Barres par jour : recette (plein) et dépenses (contour), même échelle
function chart(month, V, D) {
  const [y, m] = month.split("-").map(Number), n = new Date(y, m, 0).getDate();
  const r = Array(n).fill(0), d = Array(n).fill(0);
  V.forEach((v) => { r[+v.day.slice(8) - 1] += v.price; });
  D.forEach((x) => { d[+x.day.slice(8) - 1] += x.amount; });
  const max = Math.max(1000, ...r, ...d), step = [1000, 2000, 5000, 10000, 20000, 50000, 100000].find((s) => max / s <= 4) || 200000, top = Math.ceil(max / step) * step;
  const W = 640, H = 200, L = 52, B = 22, bw = (W - L - 8) / n;
  const yy = (v) => H - B - (v / top) * (H - B - 10);
  let g = "";
  for (let v = 0; v <= top; v += step) g += `<line x1="${L}" x2="${W}" y1="${yy(v)}" y2="${yy(v)}" class="grid"/><text x="${L - 6}" y="${yy(v) + 4}" text-anchor="end">${v >= 1000 ? v / 1000 + "k" : v}</text>`;
  const bars = r.map((v, i) => `<rect x="${L + i * bw + 1}" y="${yy(v)}" width="${Math.max(1, bw * 0.55)}" height="${H - B - yy(v)}" class="bar-r"><title>${i + 1} : ${fcfa(v)}</title></rect>` + (d[i] ? `<rect x="${L + i * bw + bw * 0.55 + 1}" y="${yy(d[i])}" width="${Math.max(1, bw * 0.3)}" height="${H - B - yy(d[i])}" class="bar-d"><title>Dépenses du ${i + 1} : ${fcfa(d[i])}</title></rect>` : "")).join("");
  const lab = [1, 5, 10, 15, 20, 25, n].map((i) => `<text x="${L + (i - 0.5) * bw}" y="${H - 6}" text-anchor="middle">${i}</text>`).join("");
  return `<div class="legend small"><span><i class="bar-r"></i>Recette</span><span><i class="bar-d"></i>Dépenses</span></div><div class="tbl-wrap"><svg viewBox="0 0 ${W} ${H}" class="svg-chart" role="img" aria-label="Recette et dépenses par jour">${g}${bars}${lab}</svg></div>`;
}

// ---------- Réglages du salon (patron)
ROUTES.salon = () => {
  if (ME.role !== "patron") return go("file");
  $view.innerHTML = `<p class="muted">Chargement…</p>`;
  let built = false;
  refreshFn = async () => {
    const s = LIVE.salon; if (!s) return;
    if (!built) {
      built = true;
      $view.innerHTML = `<div id="s-root" class="stack-l"><h1>Salon</h1>
        <div class="quick"><a class="btn alt" href="#clients">Mes clients</a><a class="btn alt" href="#offres">Offres de fêtes</a><a class="btn alt" href="#page/${esc(ME.sid)}">Page du salon</a><a class="btn alt" href="#demarrer">Mes salons</a></div>
        <details class="card" open><summary><h2>QR code et écran d'attente</h2></summary><div id="s-qr"></div></details>
        <details class="card"><summary><h2>Coupes et prix</h2></summary><div id="s-svc" class="list"></div><button class="btn alt" type="button" id="svc-add">Ajouter une coupe</button></details>
        <details class="card"><summary><h2>Coiffeurs et pointage</h2></summary><div id="s-coif"></div><h3>Aujourd'hui</h3><div id="s-pt"></div><div id="s-code"></div></details>
        <details class="card"><summary><h2>Stock de produits <span id="s-stock-b"></span></h2></summary><div id="s-stock" class="list"></div>
          <form class="row" id="st-add" data-keep><input class="field" id="st-name" maxlength="30" placeholder="Produit (ex. Lames)" required><input class="field num-f" id="st-min" inputmode="numeric" placeholder="Alerte à" aria-label="Quantité minimale avant alerte"><button class="btn alt">Ajouter</button></form></details>
        <details class="card"><summary><h2>Galerie des réalisations</h2></summary><p class="small muted">Photos de belles coupes faites au salon. Les clients les voient sur la page du salon et peuvent les partager.</p><div id="s-gal" class="gal"></div><label class="btn alt">Ajouter une photo<input type="file" accept="image/*" hidden id="gal-f"></label></details>
        <details class="card"><summary><h2>QR Wave du salon</h2></summary><p class="small muted">Prends en photo ton QR code Wave marchand : le client le scanne sur l'écran pour payer.</p><div id="s-wave"></div></details>
        <details class="card"><summary><h2>Informations et horaires</h2></summary><form id="s-info" data-keep>
          <label class="lbl" for="i-name">Nom</label><input class="field" id="i-name" maxlength="40">
          <label class="lbl" for="i-q">Quartier</label><input class="field" id="i-q" maxlength="50">
          <label class="lbl" for="i-tel">WhatsApp et Wave du salon</label><input class="field" id="i-tel" inputmode="tel" maxlength="20">
          <div class="row"><label class="mini">Ouverture <input class="field" id="i-open" type="time"></label><label class="mini">Fermeture <input class="field" id="i-close" type="time"></label></div>
          <label class="lbl" for="i-hor">Horaires spéciaux (facultatif)</label><input class="field" id="i-hor" maxlength="100" placeholder="Ex. Vendredi après la prière, fermé le dimanche">
          <button class="btn alt">Enregistrer</button></form>
          <div class="stack sw-list">
            <label class="sw"><input type="checkbox" id="o-ann"> Visible dans l'annuaire des salons</label>
            <button type="button" class="btn-ghost sm" id="o-pos">Enregistrer la position du salon (pour l'itinéraire)</button><span class="small muted" id="o-pos-st"></span>
            <label class="sw"><input type="checkbox" id="o-dom"> Coiffure à domicile sur rendez-vous, supplément <input class="field num-f" id="o-dom-x" inputmode="numeric" aria-label="Supplément à domicile"> F</label>
            <label class="sw">Acompte pour les grandes occasions <input class="field num-f" id="o-acc" inputmode="numeric" aria-label="Acompte"> F</label>
            <label class="sw"><input type="checkbox" id="o-simple"> Mode simple : caisse et bilan seulement (coiffeur seul ou ambulant)</label>
          </div></details>
        <details class="card"><summary><h2>Ce téléphone</h2></summary><div id="s-me"></div></details></div>`;
      $("#svc-add").onclick = () => { const list = services().concat({ id: uid(), name: "Nouvelle coupe", price: 1000, dur: 20, photo: "" }); Store.updateSalon(ME.sid, { services: list }); };
      $("#s-info").onsubmit = (e) => { e.preventDefault(); Store.updateSalon(ME.sid, { name: $("#i-name").value.trim() || s.name, quartier: $("#i-q").value.trim(), tel: $("#i-tel").value.trim(), ouverture: $("#i-open").value || "09:00", fermeture: $("#i-close").value || "21:00", horaires: $("#i-hor").value.trim() }); toast("Enregistré"); };
      $("#o-ann").onchange = (e) => Store.updateSalon(ME.sid, { annuaire: e.target.checked });
      $("#o-dom").onchange = (e) => Store.updateSalon(ME.sid, { domicile: e.target.checked });
      $("#o-dom-x").onchange = (e) => Store.updateSalon(ME.sid, { domicileExtra: +e.target.value.replace(/\D/g, "") || 0 });
      $("#o-acc").onchange = (e) => Store.updateSalon(ME.sid, { acompte: +e.target.value.replace(/\D/g, "") || 0 });
      $("#o-simple").onchange = (e) => { Store.updateSalon(ME.sid, { simple: e.target.checked }); toast(e.target.checked ? "Mode simple activé" : "Mode complet activé"); };
      $("#o-pos").onclick = () => { if (!navigator.geolocation) return toast("Position indisponible."); toast("Recherche de la position…"); navigator.geolocation.getCurrentPosition((p) => { Store.updateSalon(ME.sid, { lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) }); toast("Position enregistrée"); }, () => toast("Position refusée : autorise-la dans le navigateur."), { enableHighAccuracy: true, timeout: 15000 }); };
      $("#st-add").onsubmit = (e) => { e.preventDefault(); Store.add(ME.sid, "stock", { name: $("#st-name").value.trim(), qty: 0, min: +$("#st-min").value || 0 }); $("#st-name").value = ""; $("#st-min").value = ""; };
      bindSalonEdits();
      bindPointage($("#s-pt"));
      $("#gal-f").onchange = async (e) => { const f = e.target.files[0]; if (f) { await Store.add(ME.sid, "galerie", { at: Date.now(), img: await shrink(f, 640, 0.6) }); e.target.value = ""; toast("Photo ajoutée"); } };
      $("#s-gal").onclick = (e) => { const b = e.target.closest("[data-gd]"); if (b) Store.remove(ME.sid, "galerie", b.dataset.gd); };
      viewSubs.push(Store.watch(ME.sid, "galerie", [], (rows) => { const el = $("#s-gal"); if (el) el.innerHTML = rows.sort((a, b) => b.at - a.at).map((g) => `<figure><img src="${g.img}" alt="Réalisation du salon"><button type="button" class="btn-ghost sm" data-gd="${esc(g.id)}" aria-label="Supprimer la photo">✕</button></figure>`).join("") || `<p class="empty">Aucune photo pour le moment.</p>`; }));
    }
    const fi = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v || ""; };
    fi("#i-name", s.name); fi("#i-q", s.quartier); fi("#i-tel", s.tel); fi("#i-open", s.ouverture || "09:00"); fi("#i-close", s.fermeture || "21:00"); fi("#i-hor", s.horaires);
    fi("#o-dom-x", String(s.domicileExtra || 1000)); fi("#o-acc", String(s.acompte || 2000));
    $("#o-ann").checked = !!s.annuaire; $("#o-dom").checked = !!s.domicile; $("#o-simple").checked = !!s.simple;
    $("#o-pos-st").textContent = s.lat ? `Position enregistrée (${s.lat}, ${s.lng})` : "Pas encore de position";
    if (!$("#s-qr").dataset.done) {
      $("#s-qr").dataset.done = 1;
      $("#s-qr").innerHTML = `<div class="qr-box"><div class="qr-print" id="qr-print"><b>${esc(s.name)}</b>${qrSvg(ticketUrl(ME.sid), 200)}<span>Scanne pour prendre ta place</span><span class="code">${esc(ME.sid)}</span></div>
        <div class="stack"><p class="small">Colle ce QR code dans le salon : les clients le scannent pour prendre un ticket (ou entrent le code <b>${esc(ME.sid)}</b>).</p>
        <button type="button" class="btn" id="qr-dl">Télécharger l'affiche</button>
        <a class="btn alt" href="#ecran/${esc(ME.sid)}">Ouvrir l'écran d'attente</a><p class="small muted">Sur un vieux téléphone ou une télé avec navigateur, laissé allumé dans le salon.</p></div></div>`;
      $("#qr-dl").onclick = () => downloadPoster(s);
    }
    $("#s-svc").innerHTML = services().map((sv) => `<div class="svc-edit" data-sv="${esc(sv.id)}" data-keep>
      <label class="ph-btn">${svcThumb(sv)}<input type="file" accept="image/*" hidden data-f="photo"><span class="small">Photo</span></label>
      <div class="svc-fields"><input class="field" data-f="name" value="${esc(sv.name)}" maxlength="30" aria-label="Nom de la coupe">
        <div class="row"><label class="mini"><input class="field" data-f="price" inputmode="numeric" value="${sv.price}" aria-label="Prix"><span>F</span></label><label class="mini"><input class="field" data-f="dur" inputmode="numeric" value="${sv.dur}" aria-label="Durée en minutes"><span>min</span></label>
        <button type="button" class="btn-ghost sm" data-rm="svc" aria-label="Supprimer la coupe">✕</button></div>
        <label class="sw small"><input type="checkbox" data-f="express"${sv.express ? " checked" : ""}> Express (passe en priorité, ex. barbe seule)</label></div></div>`).join("");
    $("#s-coif").innerHTML = coiffeurs().map((c) => `<div class="svc-edit" data-co="${esc(c.id)}" data-keep><div class="svc-fields"><div class="row">
        <input class="field" data-f="name" value="${esc(c.name)}" maxlength="25" aria-label="Prénom"><label class="mini"><input class="field" data-f="pct" inputmode="numeric" value="${c.pct}" aria-label="Commission en pour cent"><span>%</span></label>
        <button type="button" class="btn-ghost sm" data-rm="coif" aria-label="Retirer le coiffeur">✕</button></div></div></div>`).join("") + `<button class="btn alt" type="button" id="coif-add">Ajouter un coiffeur</button>`;
    $("#coif-add").onclick = () => Store.updateSalon(ME.sid, { coiffeurs: coiffeurs().concat({ id: uid(), name: "Coiffeur", pct: 40 }) });
    $("#s-pt").innerHTML = pointageHtml(coiffeurs());
    if (!$("#s-code").dataset.done) {
      $("#s-code").dataset.done = 1;
      const c = await Store.staffCode(ME.sid).catch(() => "");
      $("#s-code").innerHTML = `<div class="banner plain"><span>Pour qu'un coiffeur utilise son téléphone : code du salon <b class="code">${esc(ME.sid)}</b>, code coiffeur <b class="code" id="sc">${esc(c)}</b>. Il voit ses coupes, pas la recette du salon.</span><button class="btn-ghost sm" type="button" id="sc-new">Changer le code</button></div>`;
      $("#sc-new").onclick = async () => { $("#sc").textContent = await Store.newStaffCode(ME.sid); toast("Nouveau code coiffeur"); };
    }
    const low = LIVE.stock.filter((x) => x.qty <= (x.min || 0));
    $("#s-stock-b").innerHTML = low.length ? `<i class="badge">${low.length}</i>` : "";
    $("#s-stock").innerHTML = LIVE.stock.length ? LIVE.stock.sort((a, b) => a.name.localeCompare(b.name)).map((x) => `<div class="v-item ${x.qty <= (x.min || 0) ? "low" : ""}" data-st="${esc(x.id)}"><div class="q-main"><b>${esc(x.name)}</b><span class="small ${x.qty <= (x.min || 0) ? "warn" : "muted"}">${x.qty <= (x.min || 0) ? "À racheter · " : ""}alerte à ${x.min || 0}</span></div>
      <div class="stepper"><button type="button" class="btn-ghost sm" data-d="-1" aria-label="Moins">−</button><b class="tab">${x.qty}</b><button type="button" class="btn-ghost sm" data-d="1" aria-label="Plus">+</button></div><button type="button" class="btn-ghost sm" data-rm="st" aria-label="Supprimer">✕</button></div>`).join("") : `<p class="empty">Ajoute tes produits (lames, crèmes, teintures) pour être prévenu quand il en manque.</p>`;
    $("#s-wave").innerHTML = `${s.waveQr ? `<img class="wave-img" src="${s.waveQr}" alt="QR Wave du salon"><a class="btn alt" href="#wave/${esc(ME.sid)}">Afficher en grand pour le client</a>` : ""}<label class="btn ${s.waveQr ? "btn-ghost" : "alt"}">${s.waveQr ? "Changer la photo" : "Prendre la photo du QR Wave"}<input type="file" accept="image/*" hidden id="wave-f"></label>`;
    $("#wave-f").onchange = async (e) => { const f = e.target.files[0]; if (f) { await Store.updateSalon(ME.sid, { waveQr: await shrink(f, 700, 0.8) }); toast("QR Wave enregistré"); } };
    $("#s-me").innerHTML = `<p class="small muted">Compte : ${esc(Store.email || "")}<br>Identifiant : <code>${esc(Store.uid || "")}</code></p>
      <div class="row"><button class="btn-ghost" type="button" id="me-sw">Changer de salon</button><button class="btn-ghost" type="button" id="me-out">Se déconnecter</button></div>`;
    $("#me-sw").onclick = () => { Object.assign(ME, { role: null, sid: null }); saveMe(); go("accueil"); };
    const out = $("#me-out"); if (out) out.onclick = async () => { await Store.signOut(); Object.assign(ME, { role: null, sid: null }); saveMe(); go("accueil"); };
    tabs("salon");
  };
  refresh();
};
function bindSalonEdits() {
  const saveList = (key, id, patch) => Store.updateSalon(ME.sid, { [key]: (key === "services" ? services() : coiffeurs()).map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const root = $("#s-root");
  root.addEventListener("change", async (e) => {
    const f = e.target.dataset.f; if (!f) return;
    const sv = e.target.closest("[data-sv]"), co = e.target.closest("[data-co]");
    if (sv) {
      if (f === "photo") { const file = e.target.files[0]; if (file) saveList("services", sv.dataset.sv, { photo: await shrink(file, 320, 0.6) }); return; }
      if (f === "express") return saveList("services", sv.dataset.sv, { express: e.target.checked });
      saveList("services", sv.dataset.sv, { [f]: f === "name" ? e.target.value.trim() : Math.max(0, +e.target.value.replace(/\D/g, "") || 0) });
    }
    if (co) saveList("coiffeurs", co.dataset.co, { [f]: f === "name" ? e.target.value.trim() : Math.min(100, +e.target.value.replace(/\D/g, "") || 0) });
  });
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const st = b.closest("[data-st]");
    if (st && b.dataset.d) { const x = LIVE.stock.find((y) => y.id === st.dataset.st); Store.update(ME.sid, "stock", x.id, { qty: Math.max(0, x.qty + +b.dataset.d) }); }
    if (b.dataset.rm === "st") { const x = LIVE.stock.find((y) => y.id === st.dataset.st); Store.remove(ME.sid, "stock", x.id); toast(`${x.name} supprimé`, () => Store.set(ME.sid, "stock", x.id, { name: x.name, qty: x.qty, min: x.min })); }
    if (b.dataset.rm === "svc") { const id = b.closest("[data-sv]").dataset.sv, old = services(); Store.updateSalon(ME.sid, { services: old.filter((x) => x.id !== id) }); toast("Coupe supprimée", () => Store.updateSalon(ME.sid, { services: old })); }
    if (b.dataset.rm === "coif") {
      if (coiffeurs().length <= 1) return toast("Il faut au moins un coiffeur.");
      const id = b.closest("[data-co]").dataset.co, old = coiffeurs(); Store.updateSalon(ME.sid, { coiffeurs: old.filter((x) => x.id !== id) }); toast("Coiffeur retiré", () => Store.updateSalon(ME.sid, { coiffeurs: old }));
    }
  });
}
// Affiche à imprimer : QR code et code du salon, en PNG
function downloadPoster(s) {
  const q = qrcode(0, "M"); q.addData(ticketUrl(ME.sid)); q.make();
  const n = q.getModuleCount(), cell = Math.floor(700 / (n + 4)), W = 900, H = 1200, c = document.createElement("canvas");
  c.width = W; c.height = H; const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 12; i++) { g.fillStyle = ["#c41e3a", "#fff", "#1f4fbf"][i % 3]; g.beginPath(); g.moveTo(i * 90 - 60, 0); g.lineTo(i * 90 + 30, 0); g.lineTo(i * 90 - 30, 60); g.lineTo(i * 90 - 120, 60); g.fill(); }
  g.fillStyle = "#121a2b"; g.textAlign = "center"; g.font = "bold 64px sans-serif"; g.fillText(s.name, W / 2, 170);
  g.font = "40px sans-serif"; g.fillText("Scanne pour prendre ta place", W / 2, 240);
  const ox = (W - n * cell) / 2, oy = 300;
  g.fillStyle = "#000"; for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect(ox + k * cell, oy + r * cell, cell, cell);
  g.fillStyle = "#121a2b"; g.font = "36px sans-serif"; g.fillText("ou entre le code du salon", W / 2, oy + n * cell + 80);
  g.font = "bold 96px monospace"; g.fillText(ME.sid, W / 2, oy + n * cell + 190);
  const a = document.createElement("a"); a.download = `affiche-${ME.sid}.png`; a.href = c.toDataURL("image/png"); a.click();
}

// ---------- Page client : prendre son ticket et suivre son tour (idées 1, 2, 3, 7, 10)
ROUTES.ticket = (sid) => {
  sid = (sid || "").toUpperCase();
  if (!isStaff()) { ME.role = "client"; ME.sid = sid; saveMe(); }
  follow(sid, isStaff() && ME.sid === sid ? ME.role : "client");
  let choice = { svc: null, coif: "" }, notified = false, lastStatus = null;
  $view.innerHTML = `<div id="t-body"><p class="muted">Chargement du salon…</p></div>`;
  const mineId = () => { const tk = ME.tickets[sid]; return tk && tk.day === dayOf() ? tk.id : null; };
  refreshFn = () => {
    const s = LIVE.salon;
    if (s === null && LIVE.sid === sid) { $("#t-body").innerHTML = `<h1>Salon introuvable</h1><p class="muted">Vérifie le code du salon.</p><a class="btn alt" href="#accueil" id="t-back">Retour</a>`; $("#t-back").onclick = () => { ME.role = isStaff() ? ME.role : null; saveMe(); }; return; }
    if (!s) return;
    const est = estimate(), w = waiting(), me = LIVE.queue.find((e) => e.id === mineId());
    const head = `<div class="t-head"><div><h1>${esc(s.name)}</h1><p class="muted small">${esc(s.quartier || "")}</p></div>
      <div class="lang" role="group" aria-label="Langue"><button type="button" data-l="fr" aria-pressed="${ME.lang === "fr"}">FR</button><button type="button" data-l="wo" aria-pressed="${ME.lang === "wo"}">WO</button></div></div>`;
    const foot = isStaff() ? "" : `<button class="btn-ghost sm switch" type="button" id="t-switch">Changer de profil ou de salon</button>`;
    if (me && !["fini", "parti"].includes(me.status)) {
      const pos = w.findIndex((e) => e.id === me.id), mins = est[me.id] ?? 0;
      if (me.status === "appele" && lastStatus !== "appele") alertMe(t("C'est ton tour !"), t("Présente-toi au salon."));
      else if (me.status === "attente" && mins <= 10 && !notified) { notified = true; alertMe(`${s.name}`, "Ton tour arrive dans 10 minutes."); }
      lastStatus = me.status;
      $("#t-body").innerHTML = head + `<div class="ticket ${me.status}">
          <span class="lbl">${t("Ton numéro")}</span><b class="big-num">${me.num}</b>
          ${me.status === "appele" ? `<p class="call">${t("C'est ton tour !")}<br><span>${t("Présente-toi au salon.")}</span></p>`
            : me.status === "fauteuil" ? `<p class="call">${t("Au fauteuil")}</p>`
            : `<p class="pos"><b>${pos}</b> ${pos > 1 ? t("personnes avant toi") : t("personne avant toi")}</p>
               <p>${t("Attente estimée")} : <b>${waitLabel(mins)}</b></p><p class="small">${t("Viens vers")} <b>${hm(Date.now() + Math.max(0, mins - 5) * 6e4)}</b></p>`}
          <span class="small">${esc(svcOf(me.serviceId).name)} · ${fcfa(svcOf(me.serviceId).price)}</span></div>
        ${me.status === "attente" ? `<div class="stack"><button class="btn alt" type="button" id="t-notif">${t("Me prévenir 10 minutes avant")}</button><button class="btn-ghost" type="button" id="t-cancel">${t("Je ne viens plus")}</button></div>` : ""}
        ${s.waveQr ? `<a class="btn-ghost" href="#wave/${esc(sid)}">Payer avec Wave</a>` : ""}` + foot;
      const n = $("#t-notif"); if (n) n.onclick = async () => { if ("Notification" in window) { const r = await Notification.requestPermission(); toast(r === "granted" ? "Tu seras prévenu (garde la page ouverte)." : "Les notifications sont refusées sur ce téléphone."); } else toast("Garde cette page ouverte : le téléphone vibrera."); };
      const c = $("#t-cancel"); if (c) c.onclick = () => { Store.update(sid, "queue", me.id, { status: "parti" }); delete ME.tickets[sid]; saveMe(); };
    } else {
      if (me && me.status === "fini") keepHistory(s, me);
      const last = est._next;
      const svs = services();
      if (!choice.svc && svs[0]) choice.svc = svs[0].id;
      $("#t-body").innerHTML = head + (me && me.status === "fini" ? `<div class="banner ok">${t("Merci et à bientôt !")}</div>` : "") +
        (s.blocked ? `<div class="banner">Ce salon n'est pas disponible dans l'appli pour le moment.</div>` : !s.open ? `<div class="banner">${t("Salon fermé pour le moment")}</div>` : `
        <div class="kpis"><div><b>${w.length}</b><span>${t("en attente")}</span></div><div><b>${waitLabel(last)}</b><span>${t("Attente estimée")}</span></div></div>
        ${offersHtml(s)}
        <a class="btn alt" href="#reserver/${esc(sid)}">Prendre rendez-vous à une heure fixe</a>
        <form id="t-form" data-keep>
          <h2 class="sec">${t("Choisis ta coupe")}</h2>
          <div class="cat" id="t-cat">${svs.map((sv) => `<button type="button" class="cat-item" data-s="${esc(sv.id)}" aria-pressed="${choice.svc === sv.id}">${svcThumb(sv, "cat-img")}<b>${esc(sv.name)}</b><span>${fcfa(sv.price)} · ${sv.dur} ${t("min")}${sv.express ? " · express" : ""}</span></button>`).join("")}</div>
          ${coiffeurs().length > 1 ? `<h2 class="sec">${t("Coiffeur")}</h2><div class="chips" id="t-coif"><button type="button" class="chip" data-c="" aria-pressed="${!choice.coif}">${t("Peu importe")}</button>${coiffeurs().map((c) => `<button type="button" class="chip" data-c="${esc(c.id)}" aria-pressed="${choice.coif === c.id}">${esc(c.name)}</button>`).join("")}</div>` : ""}
          <label class="lbl" for="t-name">${t("Ton prénom")}</label><input class="field" id="t-name" maxlength="30" required autocomplete="given-name" value="${esc(ME.name || "")}">
          <label class="lbl" for="t-tel">${t("Ton numéro (pour être prévenu)")}</label><input class="field" id="t-tel" inputmode="tel" maxlength="20" autocomplete="tel" value="${esc(ME.tel || "")}">
          <button class="btn big">${t("Prendre mon ticket")}</button><p class="small" id="t-msg"></p></form>`) + historyHtml(sid) + `<div class="row"><a class="btn-ghost" href="#page/${esc(sid)}">Page du salon</a><a class="btn-ghost" href="#galerie/${esc(sid)}">${t("Nos réalisations")}</a></div>` + foot;
      const f = $("#t-form");
      if (f) {
        $("#t-cat").onclick = (e) => { const b = e.target.closest("[data-s]"); if (!b) return; choice.svc = b.dataset.s; $$("#t-cat [data-s]").forEach((x) => x.setAttribute("aria-pressed", x === b)); };
        const tc = $("#t-coif"); if (tc) tc.onclick = (e) => { const b = e.target.closest("[data-c]"); if (!b) return; choice.coif = b.dataset.c; $$("#t-coif [data-c]").forEach((x) => x.setAttribute("aria-pressed", x === b)); };
        $$("[data-again]").forEach((b) => (b.onclick = () => { if (services().some((x) => x.id === b.dataset.again)) { choice.svc = b.dataset.again; refresh(); toast("Même coupe choisie"); } }));
        f.onsubmit = async (e) => {
          e.preventDefault();
          const name = $("#t-name").value.trim(), tel = $("#t-tel").value.trim(); if (!name) return;
          ME.name = name; ME.tel = tel; saveMe();
          $("#t-msg").textContent = "…";
          try {
            const u = await Store.ensureUser();
            const day = dayOf(), num = await Store.nextNumber(sid, day);
            const id = await Store.add(sid, "queue", { day, num, name, serviceId: choice.svc, coiffeurId: choice.coif || null, status: "attente", at: Date.now(), uid: u, express: !!svcOf(choice.svc).express }, true);
            if (tel) Store.set(sid, "contacts", id, { day, phone: tel }).catch(() => {});
            ME.tickets[sid] = { id, day }; saveMe(); notified = false; lastStatus = null; refresh();
          } catch (er) { $("#t-msg").className = "small msg-ko"; $("#t-msg").textContent = "Ticket impossible pour le moment. Vérifie le réseau."; }
        };
      }
    }
    $$("[data-l]").forEach((b) => (b.onclick = () => { ME.lang = b.dataset.l; saveMe(); refresh(); }));
    const sw = $("#t-switch"); if (sw) sw.onclick = () => { Object.assign(ME, { role: null, sid: null }); saveMe(); go("accueil"); };
  };
  idle = setInterval(refresh, 30000);
  refresh();
};
// Historique des coupes du client, gardé sur son téléphone (idée 48)
function keepHistory(s, e) {
  ME.history = ME.history || [];
  const h = ME.history.find((x) => x.id === e.id);
  if (h) { if (e.photo && h.photo !== e.photo) { h.photo = e.photo; saveMe(); } return; }
  ME.history.unshift({ id: e.id, sid: s.id, salon: s.name, day: e.day, svc: svcOf(e.serviceId).name, serviceId: e.serviceId, photo: e.photo || "" });
  ME.history = ME.history.slice(0, 30); saveMe();
}
function historyHtml(sid) {
  const h = (ME.history || []).filter((x) => x.sid === sid);
  if (!h.length) return "";
  return `<section><h2 class="sec">Mes coupes ici</h2><div class="list">${h.slice(0, 8).map((x) => `<div class="v-item">${x.photo ? `<img class="cl-ph" src="${x.photo}" alt="Ma coupe">` : ""}<div class="q-main"><b>${esc(x.svc)}</b><span class="small muted">${new Date(x.day + "T12:00").toLocaleDateString("fr-FR")}</span></div><button type="button" class="btn-ghost sm" data-again="${esc(x.serviceId)}">Refaire la même</button></div>`).join("")}</div></section>`;
}
function saveClientPhoto(phone, img) { const id = phoneKey(phone); if (id) Store.getDoc(ME.sid, "clients", id).then((c) => c && Store.update(ME.sid, "clients", id, { photo: img })).catch(() => {}); }

// Alerte « ton tour arrive » : vibration, son et notification si le client l'a autorisée
function alertMe(title, body) {
  try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 600]); } catch (e) {}
  try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.value = 0.2; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.6); } catch (e) {}
  if ("Notification" in window && Notification.permission === "granted" && navigator.serviceWorker) navigator.serviceWorker.ready.then((r) => r.showNotification(title, { body, icon: "icons/icon-192.png", vibrate: [300, 150, 300] })).catch(() => {});
  toast(title + " " + body);
}

// ---------- Écran d'attente dans le salon (idée 6)
let wake = null;
const releaseWake = () => { if (wake) { wake.release().catch(() => {}); wake = null; } };
ROUTES.ecran = (sid) => {
  sid = (sid || "").toUpperCase();
  follow(sid, isStaff() && ME.sid === sid ? ME.role : "client");
  try { navigator.wakeLock && navigator.wakeLock.request("screen").then((w) => { wake = w; }, () => {}); } catch (e) {}
  $view.innerHTML = `<div class="screen" id="e-body"></div>`;
  refreshFn = () => {
    const s = LIVE.salon;
    if (s === null && LIVE.sid === sid) { $("#e-body").innerHTML = `<h1>Salon introuvable</h1><p>Vérifie le code du salon.</p><a class="btn alt" href="#accueil">Retour</a>`; return; }
    if (!s) return;
    const est = estimate(), w = waiting(), ch = inChair(), called = w.filter((e) => e.status === "appele");
    $("#e-body").innerHTML = `<header><b>${esc(s.name)}</b><span class="clock">${hm(Date.now())}</span><div class="lang" role="group" aria-label="Langue"><button type="button" data-l="fr" aria-pressed="${ME.lang === "fr"}">FR</button><button type="button" data-l="wo" aria-pressed="${ME.lang === "wo"}">WO</button></div></header>
      <div class="sc-grid"><div>
        ${called.length ? `<div class="sc-call">${called.map((e) => `<span><b>${e.num}</b> ${esc(e.name)}</span>`).join("")}<em>${t("C'est ton tour !")}</em></div>` : ""}
        <h2>${t("Au fauteuil")}</h2><div class="sc-row">${ch.length ? ch.map((e) => `<div class="sc-tile"><b>${e.num}</b><span>${esc(e.name)}</span><small>${esc((coifOf(e.coiffeurId) || {}).name || "")}</small></div>`).join("") : `<p class="muted">—</p>`}</div>
        <h2>${t("Suivants")}</h2><ol class="sc-next">${w.filter((e) => e.status === "attente").slice(0, 8).map((e) => `<li><b>${e.num}</b><span>${esc(e.name)}</span><small>${waitLabel(est[e.id])}</small></li>`).join("") || `<li class="muted">${s.open ? "Personne n'attend" : t("Salon fermé pour le moment")}</li>`}</ol></div>
        <aside>${qrSvg(ticketUrl(sid), 220)}<p>${t("Scanne pour prendre ta place")}</p><b class="code">${esc(sid)}</b></aside></div>`;
    $$("[data-l]").forEach((b) => (b.onclick = () => { ME.lang = b.dataset.l; saveMe(); refresh(); }));
  };
  idle = setInterval(refresh, 20000);
  refresh();
};

// ---------- Galerie des réalisations, à partager (idée 9)
ROUTES.galerie = (sid) => {
  sid = (sid || "").toUpperCase();
  follow(sid, isStaff() && ME.sid === sid ? ME.role : "client");
  let rows = [];
  const off = Store.watch(sid, "galerie", [], (r) => { rows = r.sort((a, b) => b.at - a.at); refresh(); });
  viewSubs.push(off);
  refreshFn = () => {
    const s = LIVE.salon; if (!s) return;
    $view.innerHTML = `<h1>${t("Nos réalisations")}</h1><p class="muted">${esc(s.name)}${s.quartier ? " · " + esc(s.quartier) : ""}</p>
      <div class="gal big">${rows.map((g, i) => `<figure><img src="${g.img}" alt="Coupe réalisée au salon"><button type="button" class="btn-ghost sm" data-sh="${i}">Partager</button></figure>`).join("") || `<p class="empty">Le salon n'a pas encore ajouté de photos.</p>`}</div>
      <a class="btn alt" href="#ticket/${esc(sid)}">${t("Prendre mon ticket")}</a>`;
    $view.onclick = async (e) => {
      const b = e.target.closest("[data-sh]"); if (!b) return;
      const g = rows[+b.dataset.sh], text = `Coupe faite chez ${s.name}. Prends ton ticket : ${ticketUrl(sid)}`;
      try {
        const file = new File([await (await fetch(g.img)).blob()], "coupe.jpg", { type: "image/jpeg" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) return await navigator.share({ files: [file], text });
        if (navigator.share) return await navigator.share({ text, url: ticketUrl(sid) });
      } catch (er) { if (er && er.name === "AbortError") return; }
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    };
  };
  refresh();
};

// ---------- QR Wave affiché au client (idée 88)
ROUTES.wave = (sid) => {
  sid = (sid || "").toUpperCase();
  follow(sid, isStaff() && ME.sid === sid ? ME.role : "client");
  refreshFn = () => {
    const s = LIVE.salon; if (!s) return;
    $view.innerHTML = `<div class="wave-full"><h1>Payer ${esc(s.name)} avec Wave</h1>${s.waveQr ? `<img src="${s.waveQr}" alt="QR code Wave du salon">` : `<p class="muted">Le salon n'a pas encore ajouté son QR Wave.</p>`}<p class="muted">Ouvre Wave, touche « Scanner » et vise ce code.</p><button class="btn-ghost" type="button" onclick="history.back()">Retour</button></div>`;
  };
  refresh();
};

// ---------- Installation sur l'écran d'accueil et démarrage
let installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("#install").hidden = false; });
$("#install").onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("#install").hidden = true; };
// Le serveur a refusé une écriture : le dire au lieu de faire croire que c'est enregistré
// Erreurs envoyées à l'espace admin (message, écran, salon, rôle, téléphone)
const report = (msg, extra) => Store.logError({ msg: String(msg || "?").slice(0, 500), route: location.hash.slice(0, 60), sid: ME.sid || "", role: ME.role || "", ua: navigator.userAgent.slice(0, 160), ...extra });
window.addEventListener("error", (e) => report(e.message + (e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : "")));
window.addEventListener("unhandledrejection", (e) => { const r = e.reason || {}; if (!/permission-denied/.test(r.code || "")) report(r.message || r, { code: r.code || "" }); });
window.addEventListener("store-refused", (e) => report("Écriture refusée", { code: (e.detail && e.detail.code) || "" }));
window.addEventListener("store-refused", (e) => toast(/permission/i.test(e.detail && e.detail.code || "") ? "Refusé par le serveur : cette action n'est pas autorisée." : "Enregistrement impossible. Réessaie."));
const net = () => { $("#offline").hidden = navigator.onLine; };
window.addEventListener("online", net); window.addEventListener("offline", net);
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});

(async () => {
  // attendre les autres scripts de la page (plus.js) avant le premier affichage
  if (document.readyState === "loading") await new Promise((ok) => document.addEventListener("DOMContentLoaded", ok));
  net();
  try { await Store.init(); } catch (e) { toast("Connexion au serveur impossible : mode hors connexion."); }
  render();
})();
