"use strict";
// Espace admin du propriétaire de l'appli : voir tous les salons, leur activité et les erreurs, suspendre un salon,
// et ouvrir n'importe quel salon en vue patron, coiffeur ou client (lecture seule côté règles, sauf ses propres salons).
// Le paiement de l'abonnement se fait hors de l'appli.
// Accès : comptes listés dans CFG.admins (et dans firestore.rules, qui protège les écritures).

const isAdmin = () => !!Store.uid && CFG.admins.includes(Store.uid);
const ageDays = (s) => Math.floor((Date.now() - (s.created || Date.now())) / 864e5);
// actif : des tickets ou des rendez-vous ces 7 derniers jours
const salonState = (s, a) => s.demo ? ["Démo", "trial"] : s.blocked ? ["Suspendu", "neg"] : !a ? ["…", "trial"] : a.tickets + a.rdv > 0 ? ["Actif", "ok"] : ageDays(s) < 7 ? ["Nouveau", "trial"] : ["Inactif", "late"];

ROUTES.admin = () => {
  tabs("admin");
  if (!Store.isAccount()) {
    $view.innerHTML = `<h1>Espace propriétaire</h1><div class="card"><p>Connecte-toi avec ton compte de propriétaire de l'appli.</p><button class="btn" id="ad-g" type="button">Continuer avec Google</button></div>
      <form class="card" id="ad-em" data-keep><input class="field" id="ad-mail" type="email" placeholder="E-mail" required autocomplete="email"><input class="field" id="ad-pass" type="password" placeholder="Mot de passe" required autocomplete="current-password"><button class="btn alt">Se connecter</button><p class="small" id="ad-msg"></p></form>`;
    $("#ad-g").onclick = () => Store.signIn().then(render, () => toast("Connexion impossible."));
    $("#ad-em").onsubmit = (e) => { e.preventDefault(); Store.signInEmail($("#ad-mail").value.trim(), $("#ad-pass").value, false).then(render, () => { $("#ad-msg").className = "small msg-ko"; $("#ad-msg").textContent = "E-mail ou mot de passe incorrect."; }); };
    return;
  }
  if (!isAdmin()) {
    $view.innerHTML = `<h1>Espace admin</h1><div class="card"><p>Ce compte n'est pas encore administrateur.</p>
      <p>Ton identifiant : <b class="code sel" id="ad-uid">${esc(Store.uid)}</b></p><button class="btn alt" type="button" id="ad-copy">Copier l'identifiant</button>
      <p class="small muted">Il doit être ajouté dans l'appli (config.js) et dans les règles Firebase pour ouvrir l'espace admin.</p></div>`;
    $("#ad-copy").onclick = () => navigator.clipboard.writeText(Store.uid).then(() => toast("Identifiant copié"), () => toast("Sélectionne l'identifiant pour le copier."));
    return;
  }
  let rows = [], act = {}, errs = [], q = "", filter = "tous";
  const since = dayOf(Date.now() - 7 * 864e5);
  viewSubs.push(Store.watchAllSalons((r) => {
    rows = r; paint();
    r.filter((s) => !(s.id in act)).forEach((s) => { act[s.id] = null; Store.activity(s.id, since).then((a) => { act[s.id] = a; paint(); }).catch(() => {}); });
  }, () => { $("#ad-list").innerHTML = `<p class="empty">Lecture impossible : vérifie que les règles Firebase sont à jour.</p>`; }));
  viewSubs.push(Store.watchErrors(Date.now() - 7 * 864e5, (r) => { errs = r; paint(); }));
  let tab = "comptes";
  $view.innerHTML = `<div class="head-row"><h1>Espace admin</h1><button type="button" class="btn-ghost sm" id="ad-reload" aria-label="Actualiser">↻</button></div>
    <p class="muted">Visible seulement par toi. Les patrons, les coiffeurs et les clients ne voient rien de cet espace.</p>
    <div id="ad-kpi"></div>
    <button type="button" class="ad-tog" data-tog="ad-p-demo" aria-expanded="false">🎬 Mode présentation (passer d'un rôle à l'autre)</button>
    <div class="card" id="ad-p-demo" hidden><p class="small muted">Montre l'appli sur ton seul téléphone : tu passes de patron à coiffeur ou client avec la barre en haut de l'écran.</p><div id="ad-demo" class="stack"><p class="muted">Chargement…</p></div></div>
    <button type="button" class="ad-tog" data-tog="ad-p-inv" aria-expanded="false">📲 Inviter un nouveau patron (lien ou QR code)</button>
    <div class="card" id="ad-p-inv" hidden><button class="btn" type="button" id="iv-quick">Montrer le QR au patron maintenant</button><p class="small muted">Il le scanne devant toi : l'appli s'ouvre, propose de s'installer, et il crée son salon. Ou bien prépare son salon d'avance :</p><p class="small muted" hidden>Remplis ce que tu sais. Le patron scanne le QR code ou ouvre le lien reçu par WhatsApp : l'appli lui propose de s'installer, et son salon est déjà rempli.</p>
      <form id="ad-inv" class="stack" data-keep><input class="field" id="iv-n" maxlength="40" placeholder="Nom du salon"><input class="field" id="iv-q" maxlength="50" placeholder="Quartier et ville">
        <input class="field" id="iv-t" inputmode="tel" maxlength="20" placeholder="Numéro WhatsApp du patron"><input class="field" id="iv-c" maxlength="120" placeholder="Prénoms des coiffeurs (séparés par des virgules)">
        <button class="btn">Créer le lien et le QR code</button></form><div id="iv-out"></div></div>
    <div class="ad-tabs" id="ad-tabs"><button type="button" data-tab="comptes"></button><button type="button" data-tab="erreurs"></button></div>
    <div id="ad-t-comptes">
      <input class="field" id="ad-q" placeholder="Chercher un salon, un quartier, un téléphone, un code" autocomplete="off" data-keep>
      <div class="chips" id="ad-f"></div>
      <div id="ad-list" class="list"><p class="muted">Chargement…</p></div>
      <p class="small muted">Activité = tickets et rendez-vous des 7 derniers jours. « Voir le salon » l'ouvre comme son patron le voit : tu peux tout regarder, mais pas modifier un salon qui n'est pas à toi.</p></div>
    <div id="ad-t-erreurs" hidden><div id="ad-err" class="list"></div></div>`;
  $("#ad-reload").onclick = () => render();
  $$(".ad-tog").forEach((b) => (b.onclick = () => { const p = $("#" + b.dataset.tog), open = p.hidden; p.hidden = !open; b.setAttribute("aria-expanded", open); }));
  $("#ad-tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; paint(); } };
  const demos = () => Store.mySalons().then((m) => {
    const el = $("#ad-demo"); if (!el) return;
    el.innerHTML = m.map((s) => `<button class="line-btn" type="button" data-demo="${esc(s.id)}"><b>Présenter ${esc(s.name)}</b><span class="muted small">code ${esc(s.id)}</span></button>`).join("")
      + (m.some((s) => s.demo) ? "" : `<button class="btn" type="button" id="ad-new-demo">Créer un salon de démonstration</button>`);
  }).catch(() => {});
  demos();
  // QR plein écran à faire scanner sur place, sans rien remplir
  $("#iv-quick").onclick = () => {
    const link = `${baseUrl()}#invite/${encodeURIComponent("{}")}`;
    const o = document.createElement("div"); o.className = "qr-full"; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", "QR code pour un nouveau patron");
    o.innerHTML = `<div class="qr-print"><b>Salon</b>${qrSvg(link, 280)}<span>Patron : scanne pour installer l'appli et créer ton salon</span></div><button class="btn alt" type="button">Fermer</button>`;
    o.onclick = () => o.remove(); document.body.appendChild(o);
  };
  $("#ad-inv").onsubmit = (e) => {
    e.preventDefault();
    const v = (id) => $(id).value.trim(), o = { n: v("#iv-n"), q: v("#iv-q"), t: v("#iv-t"), c: v("#iv-c") };
    Object.keys(o).forEach((k) => { if (!o[k]) delete o[k]; });
    const link = `${baseUrl()}#invite/${encodeURIComponent(JSON.stringify(o))}`;
    const text = `Bonjour${o.n ? ", voici l'appli pour " + o.n : ""} : la file d'attente, les rendez-vous et la caisse du salon sur ton téléphone. Ouvre ce lien pour créer ton salon : ${link}`;
    $("#iv-out").innerHTML = `<div class="qr-box"><div class="qr-print">${o.n ? `<b>${esc(o.n)}</b>` : ""}${qrSvg(link, 220)}<span>Scanne pour créer ton salon</span></div>
      <div class="row"><button class="btn sm" type="button" id="iv-share">Partager le lien</button><button class="btn-ghost sm" type="button" id="iv-copy">Copier</button>
      ${o.t ? `<a class="btn-ghost sm" target="_blank" rel="noopener" href="${waLink(o.t, text)}">WhatsApp</a>` : ""}</div></div>`;
    $("#iv-copy").onclick = () => navigator.clipboard.writeText(link).then(() => toast("Lien copié"), () => toast("Copie impossible"));
    $("#iv-share").onclick = async () => { try { if (navigator.share) return await navigator.share({ text, url: link }); } catch (er) { if (er.name === "AbortError") return; } navigator.clipboard.writeText(link).then(() => toast("Lien copié"), () => {}); };
  };
  $("#ad-q").oninput = (e) => { q = e.target.value.trim().toLowerCase(); paint(); };
  $("#ad-f").onclick = (e) => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; paint(); } };
  const FILTERS = [["tous", "Tous"], ["Actif", "Actif"], ["Nouveau", "Nouveau"], ["Inactif", "Inactif"], ["Suspendu", "Suspendu"], ["Démo", "Démo"]];
  const keep = (s) => filter === "tous" || salonState(s, act[s.id])[0] === filter;
  function paint() {
    if (!$("#ad-list")) return;
    const n = (st) => rows.filter((s) => salonState(s, act[s.id])[0] === st).length, real = rows.filter((s) => !s.demo).length;
    $("#ad-kpi").innerHTML = `<div class="kpis ad-kpis"><div><b>${real}</b><span>${real > 1 ? "salons inscrits" : "salon inscrit"}</span></div><div><b>${n("Actif")}</b><span>actifs cette semaine</span></div><div><b>${n("Inactif")}</b><span>inactifs (plus de 7 jours)</span></div><div><b>${errs.length}</b><span>erreurs sur 7 jours</span></div></div>`;
    $("#ad-tabs").innerHTML = `<button type="button" data-tab="comptes" aria-pressed="${tab === "comptes"}">Salons (${real})</button><button type="button" data-tab="erreurs" aria-pressed="${tab === "erreurs"}">Erreurs (${errs.length})</button>`;
    $("#ad-t-comptes").hidden = tab !== "comptes"; $("#ad-t-erreurs").hidden = tab !== "erreurs";
    $("#ad-f").innerHTML = FILTERS.filter(([f]) => f !== "Démo" || n("Démo")).map(([f, l]) => `<button type="button" class="chip" data-f="${f}" aria-pressed="${filter === f}">${l} (${f === "tous" ? rows.length : n(f)})</button>`).join("");
    const list = rows.filter((s) => keep(s) && (!q || `${s.name} ${s.quartier || ""} ${s.tel || ""} ${s.id}`.toLowerCase().includes(q)));
    $("#ad-list").innerHTML = list.length ? list.map((s) => {
      const a = act[s.id], [st, cls] = salonState(s, a), e = errs.filter((x) => x.sid === s.id).length;
      return `<div class="card ad-row" data-sid="${esc(s.id)}"><div class="head-row"><div><b>${esc(s.name)}</b> <span class="code small">${esc(s.id)}</span><br><span class="small muted">${esc(s.quartier || "")}${s.tel ? " · " + esc(s.tel) : ""} · inscrit le ${s.created ? new Date(s.created).toLocaleDateString("fr-FR") : "?"} · ${(s.coiffeurs || []).length} coiffeur(s)</span></div><span class="st st-${cls}">${st}</span></div>
        <span class="small">${a ? `${a.tickets} tickets, ${a.rdv} rendez-vous cette semaine${a.last ? " · dernier ticket " + dayLabel(a.last).toLowerCase() : ""}` : "Activité…"}${e ? ` · <b class="msg-ko">${e} erreur${e > 1 ? "s" : ""}</b>` : ""}</span>
        <div class="row"><button class="btn-ghost sm" type="button" data-ad="${s.blocked ? "unblock" : "block"}">${s.blocked ? "Réactiver" : "Suspendre"}</button>
          ${s.tel ? `<a class="btn-ghost sm" target="_blank" rel="noopener" href="${waLink(s.tel, `Bonjour, ici l'équipe de l'appli Salon. `)}">WhatsApp</a>` : ""}<button class="btn sm" type="button" data-demo="${esc(s.id)}">Voir le salon</button></div></div>`;
    }).join("") : `<p class="empty">Aucun salon.</p>`;
    const names = Object.fromEntries(rows.map((s) => [s.id, s.name]));
    $("#ad-err").innerHTML = errs.length ? errs.map((x) => `<div class="card ad-row"><div class="head-row"><span class="small"><b>${esc(x.msg)}</b>${x.code ? ` <span class="code">${esc(x.code)}</span>` : ""}</span><button class="btn-ghost sm" type="button" data-er="${esc(x.id)}" aria-label="Effacer l'erreur">✕</button></div>
      <span class="small muted">${new Date(x.at).toLocaleString("fr-FR")} · ${x.sid ? esc(names[x.sid] || x.sid) : "sans salon"} · ${esc(x.role || "client")} · écran ${esc(x.route || "accueil")}<br>${esc(x.ua || "")}</span></div>`).join("") : `<p class="empty">Aucune erreur. Tout marche.</p>`;
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
    const s = rows.find((x) => x.id === b.closest("[data-sid]").dataset.sid); if (!s) return;
    const a = b.dataset.ad;
    try {
      if (a === "block" || a === "unblock") { await Store.updateSalon(s.id, { blocked: a === "block" }); toast(a === "block" ? `${s.name} suspendu` : `${s.name} réactivé`); }
    } catch (er) { toast("Refusé : ce compte n'est pas admin dans les règles Firebase."); }
  };
};

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
