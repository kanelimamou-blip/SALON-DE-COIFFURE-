"use strict";
// Patron et patron-coiffeur : retards, pauses, crédit, objectifs et comparaisons, fermetures, messages à l'équipe,
// verrou du téléphone, gros boutons, photo avant / après (chargé après plus.js)

// ---------- Retards des coiffeurs (idée 57) : heure d'arrivée comparée à l'heure prévue
const startOf = (c) => c.debut || (LIVE.salon && hoursOn(LIVE.salon, dayOf())[0]) || "09:00";
function lateMin(c, inAt) { const d = new Date(inAt); return d.getHours() * 60 + d.getMinutes() - toMin(startOf(c)) - 5 > 0 ? d.getHours() * 60 + d.getMinutes() - toMin(startOf(c)) : 0; }

// ---------- Pause d'un coiffeur ou du patron (idée 94) : la file recalcule l'attente
function pauseBar() {
  if (!isStaff()) return "";
  const here = coiffeurs().filter((c) => LIVE.pointage.some((p) => p.coiffeurId === c.id && p.in && !p.out));
  const me = ME.role === "coiffeur" ? here.filter((c) => c.id === ME.coiffeurId) : here;
  if (!me.length) return "";
  return `<div class="pause-bar">${me.map((c) => { const u = pauseOf(c.id); return u
    ? `<button type="button" class="chip on" data-pause="${esc(c.id)}" data-v="0">${esc(c.name)} en pause jusqu'à ${hm(u)} · reprendre</button>`
    : `<button type="button" class="chip" data-pause="${esc(c.id)}" data-v="15">⏸ Pause ${esc(c.name)} 15 min</button>`; }).join("")}</div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pause]"); if (!b || !ME.sid) return;
  const id = dayOf() + "_" + b.dataset.pause, min = +b.dataset.v;
  Store.update(ME.sid, "pointage", id, { pauseUntil: min ? Date.now() + min * 6e4 : 0 });
  toast(min ? "Pause notée : l'attente des clients est recalculée" : "Pause terminée");
});
function pausedNames() {
  const p = coiffeurs().filter((c) => pauseOf(c.id));
  return p.length ? `<p class="sc-pause">${p.map((c) => `${esc(c.name)} en pause jusqu'à ${hm(pauseOf(c.id))}`).join(" · ")}</p>` : "";
}

// ---------- Objectif de recette du mois (idée 66)
function goalBar(s, total) {
  const g = s.objectif || 0; if (!g) return "";
  const pc = Math.min(100, Math.round(total / g * 100));
  return `<div class="goal"><div class="goal-t small"><span>Objectif du mois : <b>${fcfa(g)}</b></span><b>${pc} %</b></div><div class="goal-bar"><i style="width:${pc}%"></i></div></div>`;
}

// ---------- Bilan : objectif, comparaisons, meilleurs jours, charges fixes, rapport de la semaine
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const sumP = (a) => a.reduce((x, v) => x + (v.price || 0), 0);
const evol = (a, b) => !b ? "" : `<span class="${a >= b ? "msg-ok" : "msg-ko"}">${a >= b ? "+" : ""}${Math.round((a - b) / b * 100)} %</span>`;
const cmpCache = {};
function bilanPlus(month, V, D, rec) {
  const s = LIVE.salon, el = $("#b-plus"); if (!el || !s) return;
  if (el.dataset.m !== month) {
    el.dataset.m = month;
    el.innerHTML = `<div id="bp-goal"></div>
      <section class="card"><h2>Comparaison</h2><div id="bp-cmp"><p class="muted small">Chargement…</p></div></section>
      <section class="card"><h2>Charges fixes du mois</h2><div id="bp-ch"></div>
        <form class="row" id="bp-ch-f" data-keep><select class="field" id="bp-ch-c" aria-label="Charge">${DEP_CATS.map((c) => `<option>${c}</option>`).join("")}</select><input class="field num-f" id="bp-ch-a" inputmode="numeric" placeholder="Montant" required><button class="btn alt">Ajouter</button></form>
        <p class="small muted">Loyer, électricité, eau : rappelés chaque mois tant qu'ils ne sont pas notés dans les dépenses.</p></section>
      <section class="card"><h2>Meilleurs jours et meilleures heures</h2><p class="small muted">Sur les 3 derniers mois.</p><div id="bp-best"></div></section>
      <section class="card"><h2>Rapport de la semaine dernière</h2><div id="bp-week"></div></section>`;
    $("#bp-ch-f").onsubmit = (e) => { e.preventDefault(); const amount = +$("#bp-ch-a").value.replace(/\D/g, ""); if (!amount) return; Store.updateSalon(ME.sid, { charges: (s.charges || []).concat({ id: uid(), cat: $("#bp-ch-c").value, amount }) }); $("#bp-ch-a").value = ""; };
    el.onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.chAdd) { const c = (LIVE.salon.charges || []).find((x) => x.id === b.dataset.chAdd); Store.add(ME.sid, "depenses", { day: month === dayOf().slice(0, 7) ? dayOf() : month + "-01", at: Date.now(), cat: c.cat, amount: c.amount, note: "Charge fixe" }); toast(`${c.cat} noté`); }
      if (b.dataset.chRm) Store.updateSalon(ME.sid, { charges: (LIVE.salon.charges || []).filter((x) => x.id !== b.dataset.chRm) });
      if (b.id === "bp-goal-b") { const v = +($("#bp-goal-i").value || "").replace(/\D/g, ""); Store.updateSalon(ME.sid, { objectif: v }); toast(v ? "Objectif enregistré" : "Objectif retiré"); }
    };
    // mois précédent et même mois l'an passé (idée 67), lus une fois
    const prev = shiftMonth(month, -1), ly = shiftMonth(month, -12);
    Promise.all([prev, ly].map((m) => cmpCache[ME.sid + m] || (cmpCache[ME.sid + m] = Store.list(ME.sid, "ventes", [["day", ">=", m + "-01"], ["day", "<=", m + "-31"]]).catch(() => [])))).then(([p, l]) => {
      const c = $("#bp-cmp"); if (!c || el.dataset.m !== month) return;
      const r = sumP(V);
      c.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Recette</th><th>Coupes</th><th>Évolution</th></tr></thead><tbody>
        <tr><td><b>${monthLabel(month)}</b></td><td>${fcfa(r)}</td><td>${V.length}</td><td></td></tr>
        <tr><td>${monthLabel(prev)}</td><td>${fcfa(sumP(p))}</td><td>${p.length}</td><td>${evol(r, sumP(p))}</td></tr>
        <tr><td>${monthLabel(ly)}</td><td>${fcfa(sumP(l))}</td><td>${l.length}</td><td>${evol(r, sumP(l))}</td></tr></tbody></table></div>
        ${month === dayOf().slice(0, 7) ? `<p class="small muted">Le mois en cours n'est pas fini : compare à la fin du mois.</p>` : ""}`;
    });
  }
  const g = s.objectif || 0;
  if (document.activeElement && document.activeElement.id === "bp-goal-i") return;
  $("#bp-goal").innerHTML = `<section class="card"><h2>Objectif de recette</h2>${goalBar(s, rec) || `<p class="small muted">Fixe un objectif pour voir où tu en es chaque jour.</p>`}
    <div class="row" data-keep><input class="field" id="bp-goal-i" inputmode="numeric" placeholder="Objectif du mois (F)" value="${g || ""}"><button class="btn alt" type="button" id="bp-goal-b">Enregistrer</button></div></section>`;
  // charges fixes (idée 65)
  const ch = s.charges || [];
  $("#bp-ch").innerHTML = ch.length ? ch.map((c) => { const done = D.some((d) => d.cat === c.cat && d.amount === c.amount);
    return `<div class="v-item"><div class="q-main"><b>${esc(c.cat)}</b><span class="small ${done ? "msg-ok" : "warn"}">${done ? "Noté ce mois-ci" : "Pas encore noté ce mois-ci"}</span></div><b class="tab">${fcfa(c.amount)}</b>
      ${done ? "" : `<button type="button" class="btn sm" data-ch-add="${esc(c.id)}">Noter</button>`}<button type="button" class="btn-ghost sm" data-ch-rm="${esc(c.id)}" aria-label="Retirer la charge">✕</button></div>`; }).join("") : `<p class="empty">Aucune charge fixe.</p>`;
  // meilleurs jours et heures (idée 68)
  const all = LIVE.ventes, byD = Array(7).fill(0), byH = {};
  all.forEach((v) => { const d = new Date(v.at || v.day + "T12:00"); byD[d.getDay()] += v.price || 0; const h = d.getHours(); byH[h] = (byH[h] || 0) + 1; });
  const mD = Math.max(1, ...byD), hours = Object.keys(byH).map(Number).sort((a, b) => a - b), mH = Math.max(1, ...Object.values(byH));
  $("#bp-best").innerHTML = all.length ? `<div class="hbars">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<div><span>${JOURS[i].slice(0, 3)}</span><i style="width:${byD[i] / mD * 100}%"></i><b>${fcfa(byD[i])}</b></div>`).join("")}</div>
    <h3>Coupes par heure</h3><div class="hbars">${hours.map((h) => `<div><span>${h}h</span><i style="width:${byH[h] / mH * 100}%"></i><b>${byH[h]}</b></div>`).join("")}</div>` : `<p class="empty">Pas encore de ventes.</p>`;
  $("#bp-week").innerHTML = weekReport(s).html;
}
// Rapport de la semaine (idée 89) : à envoyer sur le WhatsApp du patron le dimanche soir
function lastWeek(k = 0) {
  const d = new Date(); d.setHours(12, 0, 0, 0);
  const mon = new Date(d.getTime() - ((d.getDay() + 6) % 7) * 864e5 - (7 + 7 * k) * 864e5);
  return [dayOf(mon.getTime()), dayOf(mon.getTime() + 6 * 864e5)];
}
function weekReport(s) {
  const [a, b] = lastWeek(0), [pa, pb] = lastWeek(1);
  const V = LIVE.ventes.filter((v) => v.day >= a && v.day <= b), P = LIVE.ventes.filter((v) => v.day >= pa && v.day <= pb);
  const D = LIVE.depenses.filter((d) => d.day >= a && d.day <= b).reduce((x, d) => x + d.amount, 0);
  const best = coiffeurs().map((c) => ({ c, r: sumP(V.filter((v) => v.coiffeurId === c.id)) })).sort((x, y) => y.r - x.r)[0];
  const fmt = (x) => new Date(x + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  const pc = sumP(P) ? Math.round((sumP(V) - sumP(P)) / sumP(P) * 100) : null;
  const text = `${s.name} · semaine du ${fmt(a)} au ${fmt(b)}\nRecette : ${fcfa(sumP(V))} (${V.length} coupes)${pc != null ? `, ${pc >= 0 ? "+" : ""}${pc} % par rapport à la semaine d'avant` : ""}\nDépenses : ${fcfa(D)}${best && best.r ? `\nMeilleur coiffeur : ${best.c.name} (${fcfa(best.r)})` : ""}`;
  return { text, html: `<p class="pre small">${esc(text)}</p>${s.tel ? `<a class="btn alt" target="_blank" rel="noopener" href="${waLink(s.tel, text)}">Envoyer sur mon WhatsApp</a>` : `<p class="small muted">Ajoute le numéro WhatsApp du salon (Salon, Informations) pour l'envoyer.</p>`}` };
}
function weekReportBanner(s) {
  if (ME.role !== "patron") return "";
  const d = new Date(), wk = lastWeek(0)[0];
  // dimanche à partir de 18 h, ou lundi : une fois par semaine
  if (!((d.getDay() === 0 && d.getHours() >= 18) || d.getDay() === 1) || ME.weekSeen === wk + s.id) return "";
  const r = weekReport(s);
  return `<div class="card week"><div class="head-row"><b>Ton rapport de la semaine est prêt</b><button type="button" class="btn-ghost sm" id="wk-x" onclick="ME.weekSeen='${wk + s.id}';saveMe();this.closest('.week').remove()">✕</button></div>${r.html}</div>`;
}

// ---------- Crédit client (idée 64) : la dette est suivie, la vente compte le jour du paiement
function creditsBox() {
  const el = $("#cl-credit"); if (!el) return;
  viewSubs.push(Store.watch(ME.sid, "credits", [["paid", "==", false]], (rows) => {
    const s = LIVE.salon || {}, tot = rows.reduce((x, c) => x + c.amount, 0);
    el.innerHTML = rows.length ? `<details class="card" open><summary><h2>Crédits en cours · ${fcfa(tot)}</h2></summary><div class="list">${rows.sort((a, b) => a.at - b.at).map((c) => `<div class="v-item" data-cr="${esc(c.id)}"><div class="q-main"><b>${esc(c.name)}</b><span class="small muted">${esc(c.svc)} · ${dayLabel(c.day).toLowerCase()}</span></div><b class="tab">${fcfa(c.amount)}</b>
      <button type="button" class="btn sm" data-crp="1">Payé</button>${c.phone ? `<a class="btn-ghost sm" target="_blank" rel="noopener" href="${waLink(c.phone, `Bonjour ${c.name}, ici ${s.name}. Petit rappel : il reste ${fcfa(c.amount)} pour ta coupe du ${new Date(c.day + "T12:00").toLocaleDateString("fr-FR")}. Merci !`)}">Rappeler</a>` : ""}</div>`).join("")}</div></details>` : "";
  }));
  el.onclick = async (e) => {
    const b = e.target.closest("[data-crp]"); if (!b) return;
    const id = b.closest("[data-cr]").dataset.cr, c = await Store.getDoc(ME.sid, "credits", id); if (!c) return;
    const pay = await sheet(`${c.name} paie ${fcfa(c.amount)} comment ?`, Object.entries(PAY).map(([k, l]) => ({ label: l, value: k })));
    if (!pay) return;
    await addVente({ id: c.serviceId, name: c.svc, price: c.amount }, c.coiffeurId, pay);
    Store.update(ME.sid, "credits", id, { paid: true, paidAt: Date.now() }); toast("Crédit payé, ajouté à la caisse du jour");
  };
}

// ---------- Envoi groupé WhatsApp (idée 80) : un message, puis un bouton par client
function groupSend(list, s) {
  const box = $("#cl-grp-b"); if (!box || (document.activeElement && document.activeElement.id === "grp-t")) return;
  const msg = (box.dataset.msg || `Bonjour, ici ${s.name || "le salon"}. `);
  const sent = new Set(JSON.parse(box.dataset.sent || "[]"));
  box.innerHTML = `<textarea class="field" id="grp-t" rows="3" maxlength="400" data-keep placeholder="Nouvelle coupe, fête, fermeture…">${esc(msg)}</textarea>
    <p class="small muted">WhatsApp n'envoie pas à tout le monde d'un coup : touche chaque client, le message est déjà écrit. ${sent.size}/${list.length} envoyés.</p>
    <div class="chips">${list.filter((c) => c.phone).map((c) => `<a class="chip" target="_blank" rel="noopener" data-gs="${esc(c.id)}" aria-pressed="${sent.has(c.id)}" href="${waLink(c.phone, msg.replace(/^Bonjour,/, `Bonjour ${c.name},`))}">${sent.has(c.id) ? "✓ " : ""}${esc(c.name)}</a>`).join("")}</div>`;
  $("#grp-t").onchange = (e) => { box.dataset.msg = e.target.value; groupSend(list, s); };
  box.onclick = (e) => { const a = e.target.closest("[data-gs]"); if (!a) return; sent.add(a.dataset.gs); box.dataset.sent = JSON.stringify([...sent]); setTimeout(() => groupSend(list, s), 300); };
}

// ---------- Réglages du salon : messages de l'équipe, fermetures et Ramadan, ce téléphone
function salonPlus(s) {
  const unread = LIVE.messages.filter((m) => m.from === "equipe" && !m.lu);
  $("#s-msg").innerHTML = unread.length ? `<a class="card banner-msg" href="#aide"><b>${unread.length} message${unread.length > 1 ? "s" : ""} de l'équipe de l'appli</b><span class="small">${esc(unread[unread.length - 1].text.slice(0, 90))}</span></a>` : "";
  const f = s.fermetureExc || {}, r = s.ramadan || {}, fe = $("#s-ferm");
  if (!fe.contains(document.activeElement)) fe.innerHTML = `<form id="fx-f" class="stack" data-keep><h3>Fermeture exceptionnelle</h3>
      <div class="chips" id="fx-m">${["Tabaski", "Korité", "Magal", "Gamou", "Deuil", "Travaux"].map((x) => `<button type="button" class="chip" data-v="${x}" aria-pressed="${f.motif === x}">${x}</button>`).join("")}</div>
      <input class="field" id="fx-motif" maxlength="40" placeholder="Motif" value="${esc(f.motif || "")}">
      <div class="row"><label class="mini">Du <input class="field" id="fx-du" type="date" value="${esc(f.du || "")}"></label><label class="mini">Au <input class="field" id="fx-au" type="date" value="${esc(f.au || "")}"></label></div>
      <div class="row"><button class="btn alt">Enregistrer</button>${f.du ? `<button class="btn-ghost" type="button" id="fx-x">Retirer</button>` : ""}</div>
      <p class="small muted">Les clients le voient sur la page du salon et ne peuvent pas prendre de ticket ni de rendez-vous ces jours-là.</p></form>
    <form id="rm-f" class="stack" data-keep><h3>Horaires du Ramadan</h3>
      <div class="row"><label class="mini">Du <input class="field" id="rm-du" type="date" value="${esc(r.du || "")}"></label><label class="mini">Au <input class="field" id="rm-au" type="date" value="${esc(r.au || "")}"></label></div>
      <div class="row"><label class="mini">Ouverture <input class="field" id="rm-o" type="time" value="${esc(r.ouverture || "10:00")}"></label><label class="mini">Fermeture <input class="field" id="rm-c" type="time" value="${esc(r.fermeture || "18:00")}"></label></div>
      <div class="row"><button class="btn alt">Enregistrer</button>${r.du ? `<button class="btn-ghost" type="button" id="rm-x">Retirer</button>` : ""}</div></form>`;
  const ph = $("#s-phone");
  if (!ph.contains(document.activeElement)) ph.innerHTML = `<div class="stack sw-list"><label class="sw"><input type="checkbox" id="ph-big"${ME.big ? " checked" : ""}> Gros boutons (utilisable avec le pouce, mains occupées)</label>
    <div><b class="small">Verrou de la caisse</b><p class="small muted">Avec un code, la caisse, le bilan, les clients et les réglages sont cachés sur ce téléphone quand tu coupes (tu mets un client au fauteuil à ton nom) ou après 5 minutes.</p>
    <div class="row" data-keep><input class="field num-f" id="ph-pin" inputmode="numeric" maxlength="4" placeholder="${ME.pin ? "Code actif" : "Code à 4 chiffres"}" autocomplete="off"><button class="btn alt sm" type="button" id="ph-pin-b">${ME.pin ? "Changer" : "Activer"}</button>${ME.pin ? `<button class="btn-ghost sm" type="button" id="ph-pin-x">Retirer</button>` : ""}</div></div></div>`;
}
function bindSalonPlus() {
  $("#s-root").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.closest("#fx-m")) { $("#fx-motif").value = b.dataset.v; $$("#fx-m .chip").forEach((x) => x.setAttribute("aria-pressed", x === b)); }
    if (b.id === "fx-x") { Store.updateSalon(ME.sid, { fermetureExc: null }); toast("Fermeture retirée"); }
    if (b.id === "rm-x") { Store.updateSalon(ME.sid, { ramadan: null }); toast("Horaires du Ramadan retirés"); }
    if (b.id === "ph-pin-b") { const v = $("#ph-pin").value.replace(/\D/g, ""); if (v.length !== 4) return toast("Le code doit avoir 4 chiffres."); ME.pin = pinHash(v); ME.pinOk = Date.now(); saveMe(); toast("Verrou activé"); $("#ph-pin").blur(); salonPlus(LIVE.salon); }
    if (b.id === "ph-pin-x") { ME.pin = null; saveMe(); toast("Verrou retiré"); salonPlus(LIVE.salon); }
  });
  $("#s-root").addEventListener("submit", (e) => {
    if (e.target.id === "fx-f") { e.preventDefault(); const du = $("#fx-du").value; if (!du) return toast("Choisis le premier jour."); Store.updateSalon(ME.sid, { fermetureExc: { du, au: $("#fx-au").value && $("#fx-au").value >= du ? $("#fx-au").value : du, motif: $("#fx-motif").value.trim() } }); document.activeElement.blur(); toast("Fermeture enregistrée"); }
    if (e.target.id === "rm-f") { e.preventDefault(); const du = $("#rm-du").value; if (!du) return toast("Choisis le premier jour."); Store.updateSalon(ME.sid, { ramadan: { du, au: $("#rm-au").value || du, ouverture: $("#rm-o").value || "10:00", fermeture: $("#rm-c").value || "18:00" } }); document.activeElement.blur(); toast("Horaires du Ramadan enregistrés"); }
  });
  $("#s-root").addEventListener("change", (e) => { if (e.target.id === "ph-big") { ME.big = e.target.checked; saveMe(); document.body.classList.toggle("big-ui", ME.big); } });
}

// ---------- Verrou du téléphone du patron (idée 96)
const pinHash = (v) => Array.from(v + "|salon").reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
const PIN_MS = 5 * 6e4;
const pinLocked = () => !!ME.pin && !(ME.pinOk && Date.now() - ME.pinOk < PIN_MS);
function pinRelock() { if (ME.pin) { ME.pinOk = 0; saveMe(); } }
// tant que le patron se sert de son téléphone, le verrou attend
["click", "keydown"].forEach((ev) => document.addEventListener(ev, () => { if (ME.pin && ME.pinOk && Date.now() - ME.pinOk < PIN_MS) { ME.pinOk = Date.now(); saveMe(); } }, { passive: true }));
function pinScreen(route, arg) {
  $view.innerHTML = `<h1>Caisse verrouillée</h1><form class="card stack" id="pin-f" data-keep><p class="small muted">Entre ton code pour ouvrir ${route === "salon" ? "les réglages" : route === "clients" ? "les clients" : "la caisse et le bilan"}.</p>
    <input class="field pin-in" id="pin-v" inputmode="numeric" maxlength="4" autocomplete="off" aria-label="Code" required><button class="btn">Ouvrir</button><p class="small" id="pin-m"></p></form>`;
  $("#pin-v").focus();
  $("#pin-f").onsubmit = (e) => {
    e.preventDefault();
    if (pinHash($("#pin-v").value.replace(/\D/g, "")) !== ME.pin) { $("#pin-m").className = "small msg-ko"; $("#pin-m").textContent = "Code incorrect."; $("#pin-v").value = ""; return; }
    ME.pinOk = Date.now(); saveMe(); render();
  };
}

// ---------- Photo avant / après côte à côte (idée 97)
function beforeAfter(a, b) {
  const load = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
  return Promise.all([load(a), load(b)]).then(([x, y]) => {
    const H = 480, wx = Math.round(x.width * H / x.height), wy = Math.round(y.width * H / y.height), c = document.createElement("canvas");
    c.width = wx + wy + 6; c.height = H; const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, H); g.drawImage(x, 0, 0, wx, H); g.drawImage(y, wx + 6, 0, wy, H);
    g.font = "bold 26px sans-serif"; [["Avant", 10], ["Après", wx + 16]].forEach(([t, l]) => { g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(l - 4, 8, g.measureText(t).width + 16, 36); g.fillStyle = "#fff"; g.fillText(t, l + 4, 35); });
    return c.toDataURL("image/jpeg", 0.62);
  });
}

// ---------- Messages à l'équipe de l'appli et « J'ai un problème » (idées 31, 32)
ROUTES.aide = () => {
  if (ME.role !== "patron" || !ME.sid) return go("accueil");
  $view.innerHTML = `<h1>L'équipe de l'appli</h1><p class="muted">Pose ta question ou signale un problème : on te répond ici.</p>
    <div id="ai-list" class="msgs"></div>
    <form class="card stack" id="ai-f" data-keep><div class="chips" id="ai-k"><button type="button" class="chip" data-v="probleme" aria-pressed="true">J'ai un problème</button><button type="button" class="chip" data-v="question" aria-pressed="false">Question</button><button type="button" class="chip" data-v="idee" aria-pressed="false">Idée</button></div>
      <textarea class="field" id="ai-t" rows="3" maxlength="600" required placeholder="Explique ce qui se passe"></textarea><button class="btn">Envoyer</button></form>
    <p class="small muted">Ou appelle le ${esc(CFG.contact)}.</p>`;
  let kind = "probleme";
  $("#ai-k").onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; kind = b.dataset.v; $$("#ai-k .chip").forEach((x) => x.setAttribute("aria-pressed", x === b)); };
  $("#ai-f").onsubmit = async (e) => {
    e.preventDefault();
    const text = $("#ai-t").value.trim(); if (!text) return;
    // avec le problème, l'appli joint l'écran précédent et le téléphone, pour aider sans poser de questions
    await Store.add(ME.sid, "messages", { from: "patron", kind, text, at: Date.now(), lu: false, route: ME.lastRoute || "", ua: navigator.userAgent.slice(0, 160), version: CFG.version });
    $("#ai-t").value = ""; toast("Message envoyé à l'équipe");
  };
  refreshFn = () => {
    const m = LIVE.messages;
    $("#ai-list").innerHTML = m.length ? m.map((x) => `<div class="msg ${x.from === "equipe" ? "them" : "me"}"><span>${esc(x.text)}</span><small>${x.from === "equipe" ? "Équipe" : "Moi"}${x.kind === "probleme" ? " · problème" : ""} · ${new Date(x.at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div>`).join("") : `<p class="empty">Aucun message pour le moment.</p>`;
    m.filter((x) => x.from === "equipe" && !x.lu).forEach((x) => Store.update(ME.sid, "messages", x.id, { lu: true }));
  };
  refresh();
};
window.addEventListener("hashchange", (e) => { const h = (e.oldURL.split("#")[1] || ""); if (h && !h.startsWith("aide")) { ME.lastRoute = h.slice(0, 40); } });

// ---------- Plusieurs salons : recette du mois de chacun (idée 87)
function compareSalons(mine) {
  const el = $("#cmp"); if (!el || mine.length < 2) return;
  const m = dayOf().slice(0, 7);
  Promise.all(mine.map((s) => Store.list(s.id, "ventes", [["day", ">=", m + "-01"]]).then((v) => ({ s, r: sumP(v), n: v.length }), () => ({ s, r: 0, n: 0 })))).then((rows) => {
    const max = Math.max(1, ...rows.map((x) => x.r));
    el.innerHTML = `<div class="card"><h2>Recette de ${monthLabel(m)}</h2><div class="hbars">${rows.sort((a, b) => b.r - a.r).map((x) => `<div><span>${esc(x.s.name)}</span><i style="width:${x.r / max * 100}%"></i><b>${fcfa(x.r)}</b></div>`).join("")}</div><p class="small muted">Total : ${fcfa(rows.reduce((a, x) => a + x.r, 0))} · ${rows.reduce((a, x) => a + x.n, 0)} coupes</p></div>`;
  });
}

// ---------- Version et temps de chargement de ce téléphone, vus par l'admin (idée 42)
function noteDevice() {
  setTimeout(async () => {
    if (!Store.uid) return;
    const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    const load = Math.round(nav ? nav.duration || performance.now() : performance.now());
    const c = navigator.connection || {};
    Store.setTop("appareils", Store.uid, { at: Date.now(), load, version: CFG.version, ua: navigator.userAgent.slice(0, 160), net: c.effectiveType || "", sid: ME.sid || "", role: ME.role || "", installed: installed(), mem: navigator.deviceMemory || 0 }).catch(() => {});
  }, 4000);
}
