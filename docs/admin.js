"use strict";
// Espace admin du propriétaire de l'appli : voir tous les salons, leur activité et les erreurs, suspendre un salon.
// Le paiement de l'abonnement se fait hors de l'appli.
// Accès : comptes listés dans CFG.admins (et dans firestore.rules, qui protège les écritures).

const isAdmin = () => !!Store.uid && CFG.admins.includes(Store.uid);
const ageDays = (s) => Math.floor((Date.now() - (s.created || Date.now())) / 864e5);
// actif : des tickets ou des rendez-vous ces 7 derniers jours
const salonState = (s, a) => s.blocked ? ["Suspendu", "neg"] : !a ? ["…", "trial"] : a.tickets + a.rdv > 0 ? ["Actif", "ok"] : ageDays(s) < 7 ? ["Nouveau", "trial"] : ["Inactif", "late"];

ROUTES.admin = () => {
  tabs("admin");
  if (!Store.isAccount()) {
    $view.innerHTML = `<h1>Espace admin</h1><div class="card"><p>Connecte-toi avec ton compte.</p><button class="btn" id="ad-g" type="button">Continuer avec Google</button></div>
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
  $view.innerHTML = `<h1>Espace admin</h1><div id="ad-kpi"></div>
    <div class="row" data-keep><input class="field" id="ad-q" placeholder="Chercher un salon, un quartier, un code" autocomplete="off"></div>
    <div class="chips" id="ad-f">${["tous", "actifs", "inactifs", "nouveaux", "suspendus"].map((f) => `<button type="button" class="chip" data-f="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join("")}</div>
    <div id="ad-list" class="list"><p class="muted">Chargement…</p></div>
    <p class="small muted">Activité = tickets et rendez-vous des 7 derniers jours. Les recettes des salons restent privées.</p>
    <h2>Erreurs des 7 derniers jours</h2><div id="ad-err" class="list"></div>`;
  $("#ad-q").oninput = (e) => { q = e.target.value.trim().toLowerCase(); paint(); };
  $("#ad-f").onclick = (e) => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; paint(); } };
  const keep = (s) => { const st = salonState(s, act[s.id])[0]; return filter === "tous" || (filter === "actifs" && st === "Actif") || (filter === "inactifs" && st === "Inactif") || (filter === "nouveaux" && st === "Nouveau") || (filter === "suspendus" && st === "Suspendu"); };
  function paint() {
    if (!$("#ad-list")) return;
    const n = (st) => rows.filter((s) => salonState(s, act[s.id])[0] === st).length;
    $("#ad-kpi").innerHTML = `<div class="kpis"><div><b>${rows.length}</b><span>salons inscrits</span></div><div><b>${n("Actif")}</b><span>actifs cette semaine</span></div><div><b>${n("Inactif")}</b><span>inactifs</span></div><div><b>${errs.length}</b><span>erreurs (7 j)</span></div></div>`;
    $$("#ad-f [data-f]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.f === filter));
    const list = rows.filter((s) => keep(s) && (!q || `${s.name} ${s.quartier || ""} ${s.id}`.toLowerCase().includes(q)));
    $("#ad-list").innerHTML = list.length ? list.map((s) => {
      const a = act[s.id], [st, cls] = salonState(s, a), e = errs.filter((x) => x.sid === s.id).length;
      return `<div class="card ad-row" data-sid="${esc(s.id)}"><div class="head-row"><div><b>${esc(s.name)}</b> <span class="code small">${esc(s.id)}</span><br><span class="small muted">${esc(s.quartier || "")}${s.tel ? " · " + esc(s.tel) : ""} · inscrit le ${s.created ? new Date(s.created).toLocaleDateString("fr-FR") : "?"} · ${(s.coiffeurs || []).length} coiffeur(s)</span></div><span class="st st-${cls}">${st}</span></div>
        <span class="small">${a ? `${a.tickets} tickets, ${a.rdv} rendez-vous cette semaine${a.last ? " · dernier ticket " + dayLabel(a.last).toLowerCase() : ""}` : "Activité…"}${e ? ` · <b class="msg-ko">${e} erreur${e > 1 ? "s" : ""}</b>` : ""}</span>
        <div class="row"><button class="btn-ghost sm" type="button" data-ad="${s.blocked ? "unblock" : "block"}">${s.blocked ? "Réactiver" : "Suspendre"}</button>
          ${s.tel ? `<a class="btn-ghost sm" target="_blank" rel="noopener" href="${waLink(s.tel, `Bonjour, ici l'équipe de l'appli Salon. `)}">WhatsApp</a>` : ""}<a class="btn-ghost sm" href="#page/${esc(s.id)}">Page</a></div></div>`;
    }).join("") : `<p class="empty">Aucun salon.</p>`;
    const names = Object.fromEntries(rows.map((s) => [s.id, s.name]));
    $("#ad-err").innerHTML = errs.length ? errs.map((x) => `<div class="card ad-row"><div class="head-row"><span class="small"><b>${esc(x.msg)}</b>${x.code ? ` <span class="code">${esc(x.code)}</span>` : ""}</span><button class="btn-ghost sm" type="button" data-er="${esc(x.id)}" aria-label="Effacer l'erreur">✕</button></div>
      <span class="small muted">${new Date(x.at).toLocaleString("fr-FR")} · ${x.sid ? esc(names[x.sid] || x.sid) : "sans salon"} · ${esc(x.role || "client")} · écran ${esc(x.route || "accueil")}<br>${esc(x.ua || "")}</span></div>`).join("") : `<p class="empty">Aucune erreur. Tout marche.</p>`;
  }
  $view.onclick = async (e) => {
    const er = e.target.closest("[data-er]"); if (er) return Store.removeError(er.dataset.er).catch(() => toast("Effacement refusé."));
    const b = e.target.closest("[data-ad]"); if (!b) return;
    const s = rows.find((x) => x.id === b.closest("[data-sid]").dataset.sid); if (!s) return;
    const a = b.dataset.ad;
    try {
      if (a === "block" || a === "unblock") { await Store.updateSalon(s.id, { blocked: a === "block" }); toast(a === "block" ? `${s.name} suspendu` : `${s.name} réactivé`); }
    } catch (er) { toast("Refusé : ce compte n'est pas admin dans les règles Firebase."); }
  };
};
