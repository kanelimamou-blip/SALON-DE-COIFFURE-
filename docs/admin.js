"use strict";
// Espace admin du propriétaire de l'appli : tableau du jour, salons (activité, essai, abonnement noté à la main, alertes),
// messages des patrons, invitations, base des numéros, téléphones, erreurs et journal des actions.
// Le paiement de l'abonnement se fait hors de l'appli : l'admin le note ici à la main.
// Accès : comptes listés dans CFG.admins (et dans firestore.rules) ; associés en lecture seule (admin/config).

const isAdmin = () => !!Store.uid && CFG.admins.includes(Store.uid);
let ASSOC = null;   // admin/config, lu à l'ouverture de l'espace admin
const isAssocie = () => !!Store.uid && !!ASSOC && (ASSOC.associes || []).includes(Store.uid);
const ageDays = (s) => Math.floor((Date.now() - (s.created || Date.now())) / 864e5);
const trialEnd = (s) => (s.created || Date.now()) + CFG.prix.essaiJours * 864e5;
const dateFr = (t) => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
// actif : des tickets ou des rendez-vous ces 7 derniers jours ; à risque : rien encaissé depuis 7 jours (idée 3)
const salonState = (s, a) => s.demo ? ["Démo", "trial"] : s.blocked ? ["Suspendu", "neg"] : !a ? ["…", "trial"] : a.tickets + a.rdv > 0 ? ["Actif", "ok"] : ageDays(s) < 7 ? ["Nouveau", "trial"] : ["Inactif", "late"];
const atRisk = (s, a) => !s.demo && !s.blocked && ageDays(s) >= 7 && a && a.ventes === 0;
const relanceText = (s) => `Bonjour, ici l'équipe de l'appli Salon. L'abonnement de ${s.name} est de ${fcfa(CFG.prix.mois)} par mois, ou ${fcfa(CFG.prix.an)} pour l'année (2 mois offerts). Tu peux payer par Wave ou Orange Money au ${CFG.contact}. Merci !`;
const journal = (action, sid) => Store.addTop("journal", { at: Date.now(), by: Store.uid, sid: sid || "", action }).catch(() => {});
const INV_ST = { envoyee: ["Envoyée", "trial"], ouverte: ["Ouverte", "late"], salon: ["Salon créé", "ok"], abandon: ["Abandonnée", "neg"] };
const invState = (i) => i.status === "salon" ? "salon" : Date.now() - (i.opened || i.at) > (i.opened ? 7 : 14) * 864e5 ? "abandon" : i.status === "ouverte" ? "ouverte" : "envoyee";

ROUTES.admin = async () => {
  tabs("admin");
  if (!Store.isAccount()) {
    $view.innerHTML = `<h1>Espace propriétaire</h1><div class="card"><p>Connecte-toi avec ton compte de propriétaire de l'appli.</p><button class="btn" id="ad-g" type="button">Continuer avec Google</button></div>
      <form class="card" id="ad-em" data-keep><input class="field" id="ad-mail" type="email" placeholder="E-mail" required autocomplete="email"><input class="field" id="ad-pass" type="password" placeholder="Mot de passe" required autocomplete="current-password"><button class="btn alt">Se connecter</button><p class="small" id="ad-msg"></p></form>`;
    $("#ad-g").onclick = () => Store.signIn().then(render, () => toast("Connexion impossible."));
    $("#ad-em").onsubmit = (e) => { e.preventDefault(); Store.signInEmail($("#ad-mail").value.trim(), $("#ad-pass").value, false).then(render, () => { $("#ad-msg").className = "small msg-ko"; $("#ad-msg").textContent = "E-mail ou mot de passe incorrect."; }); };
    return;
  }
  $view.innerHTML = `<p class="muted">Chargement…</p>`;
  ASSOC = await Store.getTop("admin", "config").catch(() => null);
  if (location.hash.slice(1).split("/")[0] !== "admin") return;
  if (!isAdmin() && !isAssocie()) {
    $view.innerHTML = `<h1>Espace admin</h1><div class="card"><p>Ce compte n'est pas encore administrateur.</p>
      <p>Ton identifiant : <b class="code sel" id="ad-uid">${esc(Store.uid)}</b></p><button class="btn alt" type="button" id="ad-copy">Copier l'identifiant</button>
      <p class="small muted">Envoie-le au propriétaire de l'appli : il peut t'ajouter comme associé (lecture seule), ou l'ajouter dans config.js et les règles Firebase pour un accès complet.</p></div>`;
    $("#ad-copy").onclick = () => navigator.clipboard.writeText(Store.uid).then(() => toast("Identifiant copié"), () => toast("Sélectionne l'identifiant pour le copier."));
    return;
  }
  const boss = isAdmin();   // l'associé voit tout mais ne fait aucune action, sauf répondre aux patrons
  let rows = [], act = {}, errs = [], q = "", filter = "tous", sort = "recent", tab = ME.adTab || "comptes";
  let invs = [], pays = [], logs = [], base = [], devs = [], msgs = {}, open = new Set(), usage = {}, bq = "", bf = "tous";
  const since = dayOf(Date.now() - 7 * 864e5), month = dayOf().slice(0, 7);
  const msgSubs = {};
  viewSubs.push(() => Object.values(msgSubs).forEach((f) => f()));
  viewSubs.push(Store.watchAllSalons((r) => {
    rows = r; paint();
    r.filter((s) => !(s.id in act)).forEach((s) => { act[s.id] = null; Store.activity(s.id, since).then((a) => { act[s.id] = a; paint(); }).catch(() => {}); });
    // messages des patrons (idées 31, 32), salon par salon
    r.filter((s) => !msgSubs[s.id]).forEach((s) => { msgSubs[s.id] = Store.watch(s.id, "messages", [], (m) => { msgs[s.id] = m.sort((a, b) => a.at - b.at); paint(); }); });
  }, () => { $("#ad-list").innerHTML = `<p class="empty">Lecture impossible : vérifie que les règles Firebase sont à jour.</p>`; }));
  viewSubs.push(Store.watchErrors(Date.now() - 7 * 864e5, (r) => { errs = r; paint(); }));
  viewSubs.push(Store.watchTop("invitations", (r) => { invs = r; paint(); }, { order: "at", limit: 300 }));
  viewSubs.push(Store.watchTop("paiements", (r) => { pays = r; paint(); }, { order: "at", limit: 500 }));
  viewSubs.push(Store.watchTop("journal", (r) => { logs = r; paint(); }, { order: "at", limit: 200 }));
  viewSubs.push(Store.watchTop("base", (r) => { base = r; paint(); }, { order: "last", limit: 3000 }));
  viewSubs.push(Store.watchTop("appareils", (r) => { devs = r; paint(); }, { order: "at", limit: 300 }));
  $view.innerHTML = `<div class="head-row"><h1>Espace admin</h1><button type="button" class="btn-ghost sm" id="ad-reload" aria-label="Actualiser">↻</button></div>
    <p class="muted">${boss ? "Visible seulement par toi." : "Accès associé : lecture seule, tu peux répondre aux patrons."} Les patrons, les coiffeurs et les clients ne voient rien de cet espace.</p>
    <div id="ad-kpi"></div>
    ${boss ? `<button type="button" class="ad-tog" data-tog="ad-p-demo" aria-expanded="false">🎬 Mode présentation (passer d'un rôle à l'autre)</button>
    <div class="card" id="ad-p-demo" hidden><p class="small muted">Montre l'appli sur ton seul téléphone : tu passes de patron à coiffeur ou client avec la barre en haut de l'écran.</p><div id="ad-demo" class="stack"><p class="muted">Chargement…</p></div></div>
    <button type="button" class="ad-tog" data-tog="ad-p-inv" aria-expanded="false">📲 Inviter un nouveau patron (lien ou QR code)</button>
    <div class="card" id="ad-p-inv" hidden><button class="btn" type="button" id="iv-quick">Montrer le QR au patron maintenant</button><p class="small muted">Il le scanne devant toi : l'appli s'ouvre, propose de s'installer, et il crée son salon. Ou bien prépare son salon d'avance :</p>
      <form id="ad-inv" class="stack" data-keep><input class="field" id="iv-n" maxlength="40" placeholder="Nom du salon"><input class="field" id="iv-q" maxlength="50" placeholder="Quartier et ville">
        <input class="field" id="iv-t" inputmode="tel" maxlength="20" placeholder="Numéro WhatsApp du patron"><input class="field" id="iv-c" maxlength="120" placeholder="Prénoms des coiffeurs (séparés par des virgules)">
        <button class="btn">Créer le lien et le QR code</button></form><div id="iv-out"></div></div>` : ""}
    <button type="button" class="ad-tog" data-tog="ad-p-map" aria-expanded="false">🗺 Carte des salons</button>
    <div class="card" id="ad-p-map" hidden><div id="ad-map" class="ad-map"></div><p class="small muted" id="ad-map-n"></p></div>
    ${boss ? `<button type="button" class="ad-tog" data-tog="ad-p-as" aria-expanded="false">👥 Associés (lecture seule)</button><div class="card" id="ad-p-as" hidden><div id="ad-as"></div></div>` : ""}
    <div class="chips scroll ad-tabs2" id="ad-tabs"></div>
    <div id="ad-t-comptes" data-t>
      <input class="field" id="ad-q" placeholder="Chercher un salon, un quartier, un téléphone, un code" autocomplete="off" data-keep>
      <div class="chips" id="ad-f"></div><div class="chips" id="ad-sort"></div>
      <div id="ad-list" class="list"><p class="muted">Chargement…</p></div>
      <p class="small muted">Activité = tickets et rendez-vous des 7 derniers jours. « À risque » = rien encaissé depuis 7 jours. « Voir le salon » l'ouvre comme son patron le voit.</p></div>
    <div id="ad-t-messages" data-t hidden></div>
    <div id="ad-t-invit" data-t hidden></div>
    <div id="ad-t-base" data-t hidden><div class="row" data-keep><input class="field" id="ad-bq" placeholder="Chercher un nom ou un numéro" autocomplete="off"></div><div class="chips" id="ad-bf"></div><div id="ad-base"></div></div>
    <div id="ad-t-paie" data-t hidden></div>
    <div id="ad-t-tel" data-t hidden></div>
    <div id="ad-t-erreurs" data-t hidden><div id="ad-err" class="list"></div></div>
    <div id="ad-t-journal" data-t hidden></div>`;
  $("#ad-reload").onclick = () => render();
  $$(".ad-tog").forEach((b) => (b.onclick = () => { const p = $("#" + b.dataset.tog), o = p.hidden; p.hidden = !o; b.setAttribute("aria-expanded", o); if (o && b.dataset.tog === "ad-p-map") drawMap(rows); if (o && b.dataset.tog === "ad-p-as") paintAssoc(); }));
  $("#ad-tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = ME.adTab = b.dataset.tab; saveMe(); paint(); } };
  const demos = () => Store.mySalons().then((m) => {
    const el = $("#ad-demo"); if (!el) return;
    el.innerHTML = m.map((s) => `<button class="line-btn" type="button" data-demo="${esc(s.id)}"><b>Présenter ${esc(s.name)}</b><span class="muted small">code ${esc(s.id)}</span></button>`).join("")
      + (m.some((s) => s.demo) ? "" : `<button class="btn" type="button" id="ad-new-demo">Créer un salon de démonstration</button>`);
  }).catch(() => {});
  if (boss) demos();
  // invitation suivie (idée 21) : l'invitation est enregistrée, son identifiant voyage dans le lien
  const newInvite = (o) => Store.addTopRef("invitations", { ...o, at: Date.now(), status: "envoyee", by: Store.uid }).catch(() => "");
  if (boss) {
    $("#iv-quick").onclick = async () => {
      const i = await newInvite({ n: "", t: "", sur: true });
      const link = `${baseUrl()}#invite/${encodeURIComponent(JSON.stringify(i ? { i } : {}))}`;
      const o = document.createElement("div"); o.className = "qr-full"; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", "QR code pour un nouveau patron");
      o.innerHTML = `<div class="qr-print"><b>Salon</b>${qrSvg(link, 280)}<span>Patron : scanne pour installer l'appli et créer ton salon</span></div><button class="btn alt" type="button">Fermer</button>`;
      o.onclick = () => o.remove(); document.body.appendChild(o);
    };
    $("#ad-inv").onsubmit = async (e) => {
      e.preventDefault();
      const v = (id) => $(id).value.trim(), o = { n: v("#iv-n"), q: v("#iv-q"), t: v("#iv-t"), c: v("#iv-c") };
      Object.keys(o).forEach((k) => { if (!o[k]) delete o[k]; });
      const i = await newInvite(o); if (i) o.i = i;
      const link = `${baseUrl()}#invite/${encodeURIComponent(JSON.stringify(o))}`;
      const text = `Bonjour${o.n ? ", voici l'appli pour " + o.n : ""} : la file d'attente, les rendez-vous et la caisse du salon sur ton téléphone. Ouvre ce lien pour créer ton salon : ${link}`;
      $("#iv-out").innerHTML = `<div class="qr-box"><div class="qr-print">${o.n ? `<b>${esc(o.n)}</b>` : ""}${qrSvg(link, 220)}<span>Scanne pour créer ton salon</span></div>
        <div class="row"><button class="btn sm" type="button" id="iv-share">Partager le lien</button><button class="btn-ghost sm" type="button" id="iv-copy">Copier</button>
        ${o.t ? `<a class="btn-ghost sm" target="_blank" rel="noopener" href="${waLink(o.t, text)}">WhatsApp</a>` : ""}</div></div>`;
      $("#iv-copy").onclick = () => navigator.clipboard.writeText(link).then(() => toast("Lien copié"), () => toast("Copie impossible"));
      $("#iv-share").onclick = async () => { try { if (navigator.share) return await navigator.share({ text, url: link }); } catch (er) { if (er.name === "AbortError") return; } navigator.clipboard.writeText(link).then(() => toast("Lien copié"), () => {}); };
    };
  }
  $("#ad-q").oninput = (e) => { q = e.target.value.trim().toLowerCase(); paint(); };
  $("#ad-bq").oninput = (e) => { bq = e.target.value.trim().toLowerCase(); paint(); };
  $("#ad-f").onclick = (e) => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; paint(); } };
  $("#ad-sort").onclick = (e) => { const b = e.target.closest("[data-so]"); if (b) { sort = b.dataset.so; paint(); } };
  $("#ad-bf").onclick = (e) => { const b = e.target.closest("[data-bf]"); if (b) { bf = b.dataset.bf; paint(); } };
  const FILTERS = [["tous", "Tous"], ["Actif", "Actif"], ["Nouveau", "Nouveau"], ["Inactif", "Inactif"], ["risque", "À risque"], ["Suspendu", "Suspendu"], ["Démo", "Démo"]];
  const keep = (s) => filter === "tous" || (filter === "risque" ? atRisk(s, act[s.id]) : salonState(s, act[s.id])[0] === filter);
  const score = (s) => { const a = act[s.id]; return a ? a.tickets + a.rdv + (a.ventes || 0) : -1; };
  const SORTS = { recent: ["Récents", (a, b) => (b.created || 0) - (a.created || 0)], actifs: ["Plus actifs", (a, b) => score(b) - score(a)], endormis: ["Endormis", (a, b) => score(a) - score(b)] };
  const paysOf = (sid) => pays.filter((p) => p.sid === sid);
  const unread = (sid) => (msgs[sid] || []).filter((m) => m.from === "patron" && !m.lu).length;
  function paint() {
    if (!$("#ad-list")) return;
    const n = (st) => rows.filter((s) => salonState(s, act[s.id])[0] === st).length, real = rows.filter((s) => !s.demo), A = real.map((s) => act[s.id]).filter(Boolean);
    const risk = real.filter((s) => atRisk(s, act[s.id])).length, nUnread = rows.reduce((x, s) => x + unread(s.id), 0);
    const paidMonth = pays.filter((p) => dayOf(p.at).startsWith(month)).reduce((x, p) => x + (p.amount || 0), 0);
    // tableau du jour (idée 1)
    $("#ad-kpi").innerHTML = `<div class="kpis ad-kpis"><div><b>${real.length}</b><span>${real.length > 1 ? "salons inscrits" : "salon inscrit"}</span></div><div><b>${n("Actif")}</b><span>actifs cette semaine</span></div>
      <div><b>${A.reduce((x, a) => x + a.hierT, 0)}</b><span>tickets hier</span></div><div><b>${A.reduce((x, a) => x + a.hierV, 0)}</b><span>coupes encaissées hier</span></div>
      <div class="${risk ? "neg" : ""}"><b>${risk}</b><span>à risque (rien encaissé 7 j)</span></div>${boss ? `<div class="pos"><b>${fcfa(paidMonth)}</b><span>encaissé par toi en ${MOIS[+month.slice(5) - 1]}</span></div>` : ""}
      <div class="${nUnread ? "neg" : ""}"><b>${nUnread}</b><span>messages non lus</span></div><div><b>${base.length}</b><span>numéros dans la base</span></div></div>`;
    const TABS = [["comptes", `Salons (${real.length})`], ["messages", `Messages${nUnread ? ` (${nUnread})` : ""}`], ["invit", `Invitations (${invs.length})`], ["base", `Numéros (${base.length})`], ...(boss ? [["paie", "Paiements"]] : []), ["tel", "Téléphones"], ["erreurs", `Erreurs (${errs.length})`], ["journal", "Journal"]];
    $("#ad-tabs").innerHTML = TABS.map(([k, l]) => `<button type="button" class="chip" data-tab="${k}" aria-pressed="${tab === k}">${l}</button>`).join("");
    $$("[data-t]").forEach((d) => { d.hidden = d.id !== "ad-t-" + tab; });
    $("#ad-f").innerHTML = FILTERS.filter(([f]) => f !== "Démo" || n("Démo")).map(([f, l]) => `<button type="button" class="chip" data-f="${f}" aria-pressed="${filter === f}">${l} (${f === "tous" ? rows.length : f === "risque" ? risk : n(f)})</button>`).join("");
    $("#ad-sort").innerHTML = `<span class="small muted">Trier :</span>` + Object.entries(SORTS).map(([k, [l]]) => `<button type="button" class="chip sm" data-so="${k}" aria-pressed="${sort === k}">${l}</button>`).join("");
    // liste des salons (idées 2, 3, 15) ; le détail s'ouvre à la demande
    const list = rows.filter((s) => keep(s) && (!q || `${s.name} ${s.quartier || ""} ${s.tel || ""} ${s.id}`.toLowerCase().includes(q))).sort(SORTS[sort][1]);
    if (!$("#ad-list").contains(document.activeElement) || !document.activeElement.closest("[data-keep]")) $("#ad-list").innerHTML = list.length ? list.map((s) => {
      const a = act[s.id], [st, cls] = salonState(s, a), e = errs.filter((x) => x.sid === s.id).length, p = paysOf(s.id)[0], te = trialEnd(s), u = unread(s.id);
      return `<div class="card ad-row" data-sid="${esc(s.id)}"><div class="head-row"><div><b>${esc(s.name)}</b> <span class="code small">${esc(s.id)}</span><br><span class="small muted">${esc(s.quartier || "")}${s.tel ? " · " + esc(s.tel) : ""} · inscrit le ${s.created ? dateFr(s.created) : "?"} · ${(s.coiffeurs || []).length} coiffeur(s)</span></div><span class="st st-${cls}">${st}</span></div>
        <span class="small">${a ? `${a.tickets} tickets, ${a.rdv} rendez-vous${a.ventes != null ? `, ${a.ventes} coupes encaissées` : ""} cette semaine${a.last ? " · dernier ticket " + dayLabel(a.last).toLowerCase() : ""}` : "Activité…"}${e ? ` · <b class="msg-ko">${e} erreur${e > 1 ? "s" : ""}</b>` : ""}</span>
        <span class="small">${s.demo ? "" : p ? `Dernier paiement : <b>${fcfa(p.amount)}</b> le ${dateFr(p.at)}` : te > Date.now() ? `Essai jusqu'au <b>${dateFr(te)}</b>` : `<b class="warn">Essai fini depuis ${Math.floor((Date.now() - te) / 864e5)} j, aucun paiement noté</b>`}
          ${s.blockAt && !s.blocked ? ` · <b class="warn">suspension prévue le ${dateFr(s.blockAt)}</b>` : ""}${atRisk(s, a) ? ` · <b class="msg-ko">à risque</b>` : ""}${u ? ` · <b class="msg-ko">${u} message${u > 1 ? "s" : ""}</b>` : ""}</span>
        <div class="row">${boss ? `<button class="btn-ghost sm" type="button" data-ad="${s.blocked ? "unblock" : "block"}">${s.blocked ? "Réactiver" : "Suspendre"}</button>` : ""}
          ${s.tel ? `<a class="btn-ghost sm" target="_blank" rel="noopener" href="${waLink(s.tel, `Bonjour, ici l'équipe de l'appli Salon. `)}">WhatsApp</a>` : ""}<button class="btn-ghost sm" type="button" data-ad="detail" aria-expanded="${open.has(s.id)}">${open.has(s.id) ? "Fermer" : "Détails"}</button><button class="btn sm" type="button" data-demo="${esc(s.id)}">Voir le salon</button></div>
        ${open.has(s.id) ? detail(s) : ""}</div>`;
    }).join("") : `<p class="empty">Aucun salon.</p>`;
    paintMessages(); paintInvites(); paintBase(); paintPays(); paintDevices(); paintJournal();
    const names = Object.fromEntries(rows.map((s) => [s.id, s.name]));
    $("#ad-err").innerHTML = errs.length ? errs.map((x) => `<div class="card ad-row"><div class="head-row"><span class="small"><b>${esc(x.msg)}</b>${x.code ? ` <span class="code">${esc(x.code)}</span>` : ""}</span>${boss ? `<button class="btn-ghost sm" type="button" data-er="${esc(x.id)}" aria-label="Effacer l'erreur">✕</button>` : ""}</div>
      <span class="small muted">${new Date(x.at).toLocaleString("fr-FR")} · ${x.sid ? esc(names[x.sid] || x.sid) : "sans salon"} · ${esc(x.role || "client")} · écran ${esc(x.route || "accueil")}<br>${esc(x.ua || "")}</span></div>`).join("") : `<p class="empty">Aucune erreur. Tout marche.</p>`;
  }
  // Détail d'un salon : courbe 30 j, fonctions utilisées, abonnement, suspension programmée, messages, codes, transfert, journal
  function detail(s) {
    const u = usage[s.id], P = paysOf(s.id), L = logs.filter((l) => l.sid === s.id).slice(0, 8);
    if (u === undefined) { usage[s.id] = null; Store.usage(s.id, dayOf(Date.now() - 29 * 864e5)).then((x) => { usage[s.id] = x; paint(); }, () => { usage[s.id] = { days: {}, used: {} }; paint(); }); }
    const F = [["file", "File d'attente"], ["caisse", "Caisse"], ["rdv", "Rendez-vous"], ["clients", "Fiches clients"], ["depenses", "Dépenses"], ["stock", "Stock"], ["galerie", "Galerie"], ["credits", "Crédits"]];
    const extra = [s.annuaire && "Annuaire", (s.offres || []).length && "Offres", s.waveQr && "QR Wave", s.simple && "Mode simple", s.domicile && "Domicile", s.lat && "Position"].filter(Boolean);
    return `<div class="ad-detail" data-keep>
      <h3>30 derniers jours</h3>${u ? spark(u.days) : `<p class="small muted">Chargement…</p>`}
      <h3>Fonctions utilisées</h3>${u ? `<div class="chips">${F.map(([k, l]) => `<span class="chip sm ${u.used[k] ? "on" : "off"}">${u.used[k] ? "✓" : "✕"} ${l}</span>`).join("")}${extra.map((x) => `<span class="chip sm on">✓ ${x}</span>`).join("")}</div>` : ""}
      ${boss ? `<h3>Abonnement (payé hors de l'appli)</h3>
      <p class="small">${trialEnd(s) > Date.now() ? `Essai gratuit jusqu'au <b>${dateFr(trialEnd(s))}</b>.` : `Essai fini le ${dateFr(trialEnd(s))}.`} ${P.length ? `${P.length} paiement${P.length > 1 ? "s" : ""}, ${fcfa(P.reduce((x, p) => x + p.amount, 0))} au total.` : "Aucun paiement noté."}</p>
      ${P.slice(0, 5).map((p) => `<div class="v-item small"><span>${dateFr(p.at)}</span><div class="q-main">${esc(PAY[p.via] || p.via || "")}${p.note ? " · " + esc(p.note) : ""}</div><b>${fcfa(p.amount)}</b></div>`).join("")}
      <div class="row"><select class="field" data-pf="amt" aria-label="Montant"><option value="${CFG.prix.mois}">${fcfa(CFG.prix.mois)} (1 mois)</option><option value="${CFG.prix.an}">${fcfa(CFG.prix.an)} (1 an)</option><option value="1000">${fcfa(1000)} (fondateur)</option></select>
        <select class="field" data-pf="via" aria-label="Payé par">${Object.entries(PAY).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select><button class="btn sm" type="button" data-ad="pay">Noter le paiement</button></div>
      ${s.tel ? `<a class="btn-ghost sm" target="_blank" rel="noopener" href="${waLink(s.tel, relanceText(s))}">Relancer l'abonnement sur WhatsApp</a>` : `<p class="small muted">Pas de numéro WhatsApp pour ce salon.</p>`}
      <h3>Suspension programmée</h3><div class="row"><input class="field" type="date" data-pf="blockAt" value="${s.blockAt ? dayOf(s.blockAt) : ""}" aria-label="Date de suspension"><button class="btn-ghost sm" type="button" data-ad="blockAt">Programmer</button>${s.blockAt ? `<button class="btn-ghost sm" type="button" data-ad="unblockAt">Annuler</button>` : ""}</div>
      <p class="small muted">Le salon est suspendu automatiquement ce jour-là (s'il n'a pas payé, par exemple).</p>` : ""}
      <h3>Messages</h3>${thread(s)}
      ${boss ? `<h3>Dépannage</h3><div class="row"><button class="btn-ghost sm" type="button" data-ad="code">Nouveau code coiffeur</button><button class="btn-ghost sm" type="button" data-ad="unlink">Déconnecter tous les coiffeurs</button><button class="btn-ghost sm" type="button" data-ad="transfer">Transférer à un nouveau patron</button></div>
      <p class="small muted">Patron qui a perdu son téléphone : il se reconnecte avec le même compte Google ou e-mail sur le nouveau téléphone. S'il a perdu son compte, transfère le salon.</p><div class="ad-out"></div>` : ""}
      ${L.length ? `<h3>Historique</h3>${L.map((l) => `<p class="small muted">${new Date(l.at).toLocaleString("fr-FR")} · ${esc(l.action)}</p>`).join("")}` : ""}</div>`;
  }
  function thread(s) {
    const m = msgs[s.id] || [];
    return `<div class="msgs">${m.slice(-8).map((x) => `<div class="msg ${x.from === "equipe" ? "me" : "them"}"><span>${x.kind === "probleme" ? "⚠ " : ""}${esc(x.text)}</span><small>${x.from === "equipe" ? "Équipe" : "Patron"} · ${new Date(x.at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${x.route ? " · écran " + esc(x.route) : ""}${x.version ? " · version " + esc(x.version) : ""}</small></div>`).join("") || `<p class="small muted">Aucun message.</p>`}</div>
      <div class="row" data-keep><input class="field" data-pf="msg" maxlength="600" placeholder="Écrire au patron"><button class="btn sm" type="button" data-ad="send">Envoyer</button></div>`;
  }
  // Courbe de 30 jours : tickets (plein) et coupes encaissées (contour) (idée 9)
  function spark(days) {
    const D = Array.from({ length: 30 }, (_, i) => dayOf(Date.now() - (29 - i) * 864e5)), v = D.map((d) => days[d] || { t: 0, v: 0, r: 0 });
    const max = Math.max(1, ...v.map((x) => Math.max(x.t + x.r, x.v))), W = 300, H = 60, bw = W / 30;
    return `<svg viewBox="0 0 ${W} ${H + 12}" class="spark" role="img" aria-label="Activité des 30 derniers jours">${v.map((x, i) => `<rect x="${i * bw + 1}" y="${H - (x.t + x.r) / max * H}" width="${bw * 0.5}" height="${(x.t + x.r) / max * H}" class="bar-r"><title>${D[i]} : ${x.t} tickets, ${x.r} rdv</title></rect><rect x="${i * bw + bw * 0.5 + 1}" y="${H - x.v / max * H}" width="${bw * 0.35}" height="${x.v / max * H}" class="bar-d"><title>${D[i]} : ${x.v} coupes encaissées</title></rect>`).join("")}<text x="0" y="${H + 11}">il y a 30 j</text><text x="${W}" y="${H + 11}" text-anchor="end">aujourd'hui</text></svg>
      <p class="small muted">${v.reduce((a, x) => a + x.t, 0)} tickets · ${v.reduce((a, x) => a + x.r, 0)} rendez-vous · ${v.reduce((a, x) => a + x.v, 0)} coupes encaissées</p>`;
  }
  function paintMessages() {
    const el = $("#ad-t-messages"); if (!el || el.hidden) return;
    const withMsg = rows.filter((s) => (msgs[s.id] || []).length).sort((a, b) => unread(b.id) - unread(a.id) || (msgs[b.id].slice(-1)[0].at - msgs[a.id].slice(-1)[0].at));
    if (el.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    el.innerHTML = withMsg.length ? withMsg.map((s) => `<div class="card ad-row" data-sid="${esc(s.id)}"><div class="head-row"><b>${esc(s.name)}</b>${unread(s.id) ? `<span class="st st-neg">${unread(s.id)} non lu${unread(s.id) > 1 ? "s" : ""}</span>` : ""}</div>${thread(s)}</div>`).join("") : `<p class="empty">Aucun message des patrons. Ils écrivent depuis Salon, « J'ai un problème ».</p>`;
    withMsg.forEach((s) => (msgs[s.id] || []).filter((m) => m.from === "patron" && !m.lu).forEach((m) => Store.update(s.id, "messages", m.id, { lu: true }).catch(() => {})));
  }
  // Invitations et statistiques de vente (idées 21, 22, 30)
  function paintInvites() {
    const el = $("#ad-t-invit"); if (!el || el.hidden) return;
    const st = invs.map((i) => ({ i, k: invState(i) })), payers = new Set(pays.map((p) => p.sid)), real = rows.filter((s) => !s.demo);
    const opened = st.filter((x) => x.i.opened || x.k === "salon").length, made = st.filter((x) => x.k === "salon").length;
    const pc = (a, b) => b ? Math.round(a / b * 100) + " %" : "–";
    const salons = Object.fromEntries(rows.map((s) => [s.id, s]));
    el.innerHTML = `<div class="card"><h2>Du premier contact au salon payant</h2><div class="funnel">
        <div><b>${invs.length}</b><span>invitations</span></div><div><b>${opened}</b><span>ouvertes · ${pc(opened, invs.length)}</span></div><div><b>${made}</b><span>salons créés · ${pc(made, invs.length)}</span></div>
        <div><b>${real.filter((s) => payers.has(s.id)).length}</b><span>salons payants · ${pc(real.filter((s) => payers.has(s.id)).length, real.length)} des ${real.length} salons</span></div></div></div>
      <div class="list">${st.map(({ i, k }) => { const [l, c] = INV_ST[k], link = `${baseUrl()}#invite/${encodeURIComponent(JSON.stringify({ n: i.n, q: i.q, t: i.t, c: i.c, i: i.id }))}`;
        return `<div class="card ad-row" data-inv="${esc(i.id)}"><div class="head-row"><div><b>${esc(i.n || (i.sur ? "QR montré sur place" : "Sans nom"))}</b><br><span class="small muted">${esc(i.q || "")}${i.t ? " · " + esc(i.t) : ""} · envoyée le ${dateFr(i.at)}${i.opened ? " · ouverte le " + dateFr(i.opened) : ""}${i.sid && salons[i.sid] ? " · " + esc(salons[i.sid].name) : ""}</span></div><span class="st st-${c}">${l}</span></div>
          ${k !== "salon" && i.t && boss ? `<a class="btn-ghost sm" target="_blank" rel="noopener" href="${waLink(i.t, `Bonjour${i.n ? " " + i.n : ""}, je te renvoie le lien de l'appli Salon pour créer ton salon (1 mois d'essai gratuit) : ${link}`)}">Relancer sur WhatsApp</a>` : ""}</div>`; }).join("") || `<p class="empty">Aucune invitation. Crée-en une avec « Inviter un nouveau patron ».</p>`}</div>`;
  }
  // Base des numéros (inscription par numéro)
  function paintBase() {
    const el = $("#ad-base"); if (!el || $("#ad-t-base").hidden) return;
    const names = Object.fromEntries(rows.map((s) => [s.id, s.name]));
    const nP = base.filter((b) => b.patron).length, nC = base.filter((b) => b.client).length;
    $("#ad-bf").innerHTML = [["tous", `Tous (${base.length})`], ["patron", `Patrons (${nP})`], ["client", `Clients (${nC})`]].map(([k, l]) => `<button type="button" class="chip" data-bf="${k}" aria-pressed="${bf === k}">${l}</button>`).join("");
    const list = base.filter((b) => (bf === "tous" || b[bf]) && (!bq || `${b.nom} ${b.tel}`.toLowerCase().includes(bq)));
    el.innerHTML = `<div class="row"><button class="btn alt sm" type="button" id="ad-bcopy">Copier les ${list.length} numéros</button></div>
      <div class="list">${list.slice(0, 300).map((b) => `<div class="v-item"><div class="q-main"><b>${esc(b.nom || "?")}</b><span class="small muted">${esc(b.tel)} · ${b.patron ? "patron" : ""}${b.patron && b.client ? " et " : ""}${b.client ? "client" : ""} · ${(b.sids || []).filter(Boolean).map((x) => esc(names[x] || x)).join(", ")} · ${b.n || 1} fois, dernière ${dateFr(b.last)}</span></div>
        <a class="btn-ghost sm" target="_blank" rel="noopener" href="${waLink(b.tel, "Bonjour, ")}">WhatsApp</a></div>`).join("") || `<p class="empty">Aucun numéro pour le moment. Ils arrivent à chaque ticket, rendez-vous ou salon créé.</p>`}</div>
      ${list.length > 300 ? `<p class="small muted">300 premiers affichés : cherche un nom ou un numéro.</p>` : ""}`;
    $("#ad-bcopy").onclick = () => navigator.clipboard.writeText(list.map((b) => "+221" + b.tel).join("\n")).then(() => toast(`${list.length} numéros copiés`), () => toast("Copie impossible"));
  }
  function paintPays() {
    const el = $("#ad-t-paie"); if (!el || el.hidden) return;
    const names = Object.fromEntries(rows.map((s) => [s.id, s.name])), byM = {};
    pays.forEach((p) => { const m = dayOf(p.at).slice(0, 7); byM[m] = (byM[m] || 0) + p.amount; });
    el.innerHTML = `<div class="kpis"><div><b>${fcfa(byM[month] || 0)}</b><span>en ${MOIS[+month.slice(5) - 1]}</span></div><div><b>${fcfa(byM[shiftMonth(month, -1)] || 0)}</b><span>en ${MOIS[+shiftMonth(month, -1).slice(5) - 1]}</span></div><div><b>${fcfa(pays.reduce((x, p) => x + p.amount, 0))}</b><span>depuis le début</span></div></div>
      <p class="small muted">Note un paiement depuis « Détails » d'un salon.</p>
      <div class="list">${pays.map((p) => `<div class="v-item" data-pid="${esc(p.id)}"><span class="small muted tab">${dateFr(p.at)}</span><div class="q-main"><b>${esc(names[p.sid] || p.sid)}</b><span class="small muted">${esc(PAY[p.via] || p.via || "")}</span></div><b class="tab">${fcfa(p.amount)}</b><button type="button" class="btn-ghost sm" data-ad="unpay" aria-label="Supprimer le paiement">✕</button></div>`).join("") || `<p class="empty">Aucun paiement noté.</p>`}</div>`;
  }
  // Téléphones : version, temps de chargement, réseau (idée 42)
  function paintDevices() {
    const el = $("#ad-t-tel"); if (!el || el.hidden) return;
    const names = Object.fromEntries(rows.map((s) => [s.id, s.name]));
    const flag = (d) => [d.load > 8000 && "lent", /2g/.test(d.net || "") && "réseau faible", d.version !== CFG.version && "ancienne version"].filter(Boolean);
    const list = devs.slice().sort((a, b) => flag(b).length - flag(a).length || (b.load || 0) - (a.load || 0));
    el.innerHTML = `<p class="small muted">Chaque téléphone envoie sa version et son temps de chargement à l'ouverture. Version actuelle : <b>${esc(CFG.version)}</b>.</p>
      <div class="list">${list.map((d) => { const f = flag(d); return `<div class="v-item"><div class="q-main"><b>${esc(d.role || "client")}${d.sid ? " · " + esc(names[d.sid] || d.sid) : ""}</b><span class="small muted">${(d.load / 1000).toFixed(1)} s · ${esc(d.net || "réseau ?")} · version ${esc(d.version || "?")}${d.installed ? " · installée" : ""} · ${dateFr(d.at)}<br>${esc((d.ua || "").replace(/^Mozilla\/5\.0 /, ""))}</span></div>${f.length ? `<span class="st st-late">${f.join(", ")}</span>` : `<span class="st st-ok">OK</span>`}</div>`; }).join("") || `<p class="empty">Aucun téléphone pour le moment.</p>`}</div>`;
  }
  function paintJournal() {
    const el = $("#ad-t-journal"); if (!el || el.hidden) return;
    const names = Object.fromEntries(rows.map((s) => [s.id, s.name]));
    el.innerHTML = `<p class="small muted">Tout ce qui a été fait depuis l'espace admin, et par qui.</p><div class="list">${logs.map((l) => `<div class="v-item small"><span class="muted tab">${new Date(l.at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><div class="q-main"><b>${esc(names[l.sid] || l.sid || "")}</b><span>${esc(l.action)}${l.by !== Store.uid ? " · associé" : ""}</span></div></div>`).join("") || `<p class="empty">Rien pour le moment.</p>`}</div>`;
  }
  // Associés (idée 46) : lecture seule, réponses aux patrons
  function paintAssoc() {
    const el = $("#ad-as"), list = (ASSOC && ASSOC.associes) || [];
    el.innerHTML = `<p class="small muted">Un associé voit tout l'espace admin et peut répondre aux patrons, mais ne peut ni suspendre, ni noter de paiement, ni transférer un salon. Il ouvre #admin avec son compte et t'envoie son identifiant.</p>
      ${list.map((u) => `<div class="v-item"><code class="sel">${esc(u)}</code><button type="button" class="btn-ghost sm" data-as-rm="${esc(u)}">Retirer</button></div>`).join("")}
      <div class="row" data-keep><input class="field" id="as-uid" placeholder="Identifiant de l'associé" autocomplete="off"><button class="btn alt sm" type="button" id="as-add">Ajouter</button></div>`;
    const save = async (l) => { try { await Store.setTop("admin", "config", { associes: l }, true); ASSOC = { ...(ASSOC || {}), associes: l }; paintAssoc(); toast("Associés enregistrés"); } catch (e) { toast("Refusé : vérifie les règles Firebase."); } };
    $("#as-add").onclick = () => { const v = $("#as-uid").value.trim(); if (v.length < 10) return toast("Identifiant trop court."); if (!list.includes(v)) { save(list.concat(v)); journal("Associé ajouté : " + v.slice(0, 8) + "…"); } };
    el.onclick = (e) => { const b = e.target.closest("[data-as-rm]"); if (b) { save(list.filter((x) => x !== b.dataset.asRm)); journal("Associé retiré"); } };
  }
  $view.onclick = async (e) => {
    const dm = e.target.closest("[data-demo]"); if (dm) return startDemo(dm.dataset.demo, "patron");
    if (e.target.id === "ad-new-demo") {
      e.target.disabled = true;
      try { startDemo(await newDemoSalon(), "patron"); } catch (er) { e.target.disabled = false; toast("Création impossible. Vérifie le réseau."); }
      return;
    }
    const er = e.target.closest("[data-er]"); if (er) return Store.removeError(er.dataset.er).catch(() => toast("Effacement refusé."));
    const b = e.target.closest("[data-ad]"); if (!b) return;
    const a = b.dataset.ad;
    if (a === "unpay") { const id = b.closest("[data-pid]").dataset.pid, p = pays.find((x) => x.id === id); Store.removeTop("paiements", id); journal(`Paiement de ${fcfa(p.amount)} supprimé`, p.sid); return toast("Paiement supprimé"); }
    const card = b.closest("[data-sid]"), s = card && rows.find((x) => x.id === card.dataset.sid); if (!s) return;
    const val = (k) => { const el = card.querySelector(`[data-pf="${k}"]`); return el ? el.value.trim() : ""; };
    try {
      if (a === "detail") { open.has(s.id) ? open.delete(s.id) : open.add(s.id); return paint(); }
      if (a === "block" || a === "unblock") { await Store.updateSalon(s.id, { blocked: a === "block" }); journal(a === "block" ? "Salon suspendu" : "Salon réactivé", s.id); toast(a === "block" ? `${s.name} suspendu` : `${s.name} réactivé`); }
      if (a === "pay") { const amount = +val("amt"), via = val("via"); await Store.addTop("paiements", { sid: s.id, amount, via, at: Date.now(), by: Store.uid }); journal(`Paiement de ${fcfa(amount)} noté (${PAY[via]})`, s.id); toast(`${fcfa(amount)} notés pour ${s.name}`); }
      if (a === "blockAt") { const d = val("blockAt"); if (!d) return toast("Choisis une date."); const t = new Date(d + "T00:00").getTime(); await Store.updateSalon(s.id, { blockAt: t }); journal(`Suspension programmée le ${dateFr(t)}`, s.id); toast(`Suspension programmée le ${dateFr(t)}`); }
      if (a === "unblockAt") { await Store.updateSalon(s.id, { blockAt: 0 }); journal("Suspension programmée annulée", s.id); toast("Suspension programmée annulée"); }
      if (a === "send") { const text = val("msg"); if (!text) return; await Store.add(s.id, "messages", { from: "equipe", text, at: Date.now(), lu: false, by: Store.uid }); card.querySelector('[data-pf="msg"]').value = ""; journal("Message envoyé au patron", s.id); }
      // téléphone perdu ou coiffeur parti (idée 35)
      if (a === "code") { const c = Array.from(crypto.getRandomValues(new Uint8Array(4)), (x) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join(""); await Store.merge(s.id, "private", "config", { staffCode: c }); journal("Nouveau code coiffeur", s.id); card.querySelector(".ad-out").innerHTML = `<p class="small">Nouveau code coiffeur : <b class="code">${esc(s.id)}-${c}</b>. L'ancien QR ne marche plus.</p>`; }
      if (a === "unlink") { const n = await Store.unlinkStaff(s.id); journal(`${n} téléphone(s) coiffeur déconnecté(s)`, s.id); toast(`${n} téléphone${n > 1 ? "s" : ""} déconnecté${n > 1 ? "s" : ""}`); }
      // transfert à un nouveau patron (idée 36) : lien à usage unique
      if (a === "transfer") {
        const c = Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join("");
        await Store.set(s.id, "private", "transfer", { code: c, at: Date.now() }); journal("Lien de transfert créé", s.id);
        const link = `${baseUrl()}#reprendre/${s.id}-${c}`, text = `Bonjour, voici le lien pour reprendre le salon ${s.name} dans l'appli Salon. Connecte-toi avec ton compte et le salon sera à toi : ${link}`;
        card.querySelector(".ad-out").innerHTML = `<div class="qr-box"><div class="qr-print"><b>${esc(s.name)}</b>${qrSvg(link, 200)}<span>Nouveau patron : scanne pour reprendre le salon</span></div><div class="stack"><p class="small">Le nouveau patron ouvre ce lien et se connecte : le salon passe à son compte, l'ancien patron n'y a plus accès. Le lien ne sert qu'une fois.</p>
          <a class="btn-ghost sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">Envoyer par WhatsApp</a></div></div>`;
      }
    } catch (er) { toast("Refusé : vérifie les règles Firebase (ou ce compte n'a pas ce droit)."); }
  };
  paint();
};

// ---------- Carte des salons (idée 5) : OpenStreetMap, chargée seulement quand on l'ouvre
function drawMap(rows) {
  const pts = rows.filter((s) => s.lat && s.lng && !s.demo);
  $("#ad-map-n").textContent = `${pts.length} salon${pts.length > 1 ? "s" : ""} sur ${rows.filter((s) => !s.demo).length} ont enregistré leur position (Salon, Informations, « Enregistrer la position »).`;
  const go = () => {
    const el = $("#ad-map"); if (!el) return;
    if (el._map) { el._map.remove(); }
    const m = L.map(el).setView([14.7167, -17.4677], 11); el._map = m;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
    pts.forEach((s) => L.circleMarker([s.lat, s.lng], { radius: 8, color: s.blocked ? "#c0392b" : "#c41e3a", fillOpacity: 0.8 }).addTo(m).bindPopup(`<b>${esc(s.name)}</b><br>${esc(s.quartier || "")}`));
    if (pts.length) m.fitBounds(pts.map((s) => [s.lat, s.lng]), { padding: [30, 30], maxZoom: 14 });
  };
  if (window.L) return go();
  const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(css);
  const js = document.createElement("script"); js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; js.onload = go; js.onerror = () => { $("#ad-map").innerHTML = `<p class="empty">Carte indisponible (pas de réseau).</p>`; }; document.head.appendChild(js);
}

// ---------- Mode présentation : un salon de démonstration à soi, et une barre pour changer de rôle
async function newDemoSalon() {
  const sid = await Store.createSalon({ name: "Salon Démo", quartier: "Dakar", tel: "", open: true, demo: true, services: defaultServices(),
    coiffeurs: ["Modou", "Ibou", "Pape"].map((n) => ({ id: uid(), name: n, pct: 40 })) });
  // quelques clients déjà dans la file, pour que la démo ait l'air vivante
  const s = await Store.getSalon(sid), day = dayOf(), u = await Store.ensureUser();
  for (const name of ["Fallou", "Cheikh", "Moussa"]) {
    const num = await Store.nextNumber(sid, day);
    await Store.add(sid, "queue", { day, num, name, serviceId: s.services[num % s.services.length].id, coiffeurId: null, status: "attente", at: Date.now(), uid: u, express: false });
  }
  return sid;
}
async function startDemo(sid, role) {
  ME.demo = sid;
  if (role === "coiffeur" && !coifOf(ME.coiffeurId)) { const s = await Store.getSalon(sid).catch(() => null); ME.coiffeurId = ((s && s.coiffeurs) || [])[0]?.id || null; }
  Object.assign(ME, { role, sid }); saveMe();
  go(role === "client" ? "ticket/" + sid : "file");
}
window.demoBar = () => {
  const bar = $("#demo-bar");
  bar.hidden = !ME.demo || !isAdmin() || document.body.dataset.route === "admin";
  if (bar.hidden) return;
  const cur = ME.role;
  bar.innerHTML = `<span class="small">${ME.sid && LIVE.salon && LIVE.salon.owner !== Store.uid ? `Vue de <b>${esc(LIVE.salon.name)}</b>` : "Présentation"}</span>${[["patron", "Patron"], ["coiffeur", "Coiffeur"], ["client", "Client"]].map(([r, l]) => `<button type="button" class="chip sm" data-dr="${r}" aria-pressed="${cur === r}">${l}</button>`).join("")}<button type="button" class="btn-ghost sm" data-dr="fin" aria-label="Quitter la présentation">✕</button>`;
  bar.onclick = (e) => {
    const b = e.target.closest("[data-dr]"); if (!b) return;
    if (b.dataset.dr === "fin") { Object.assign(ME, { demo: null, role: null, sid: null, coiffeurId: null }); saveMe(); return go("admin"); }
    startDemo(ME.demo, b.dataset.dr);
  };
};
