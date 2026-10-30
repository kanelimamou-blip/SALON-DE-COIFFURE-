"use strict";
// Rendez-vous, fiches clients, offres, page du salon et annuaire (chargé après app.js)

const OCCASIONS = ["Mariage", "Baptême", "Tabaski", "Korité", "Autre fête"];
const SLOT = 30;   // minutes entre deux rendez-vous
const toMin = (hh) => { const [h, m] = String(hh || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const dayLabel = (d) => { const t0 = dayOf(), t1 = dayOf(Date.now() + 864e5); if (d === t0) return "Aujourd'hui"; if (d === t1) return "Demain"; return new Date(d + "T12:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }); };
const nextDays = (n) => Array.from({ length: n }, (_, i) => dayOf(Date.now() + i * 864e5));
const phoneKey = (p) => String(p || "").replace(/\D/g, "").replace(/^221/, "").slice(-9);
const activeOffers = (s) => (s.offres || []).filter((o) => !o.until || o.until >= dayOf());

// Créneaux libres d'un jour : un rendez-vous par coiffeur et par créneau
function freeSlots(s, rdvs, day, coiffeurId) {
  const open = toMin(s.ouverture || "09:00"), close = toMin(s.fermeture || "21:00");
  const now = day === dayOf() ? new Date().getHours() * 60 + new Date().getMinutes() + 15 : 0;
  const n = Math.max(1, (s.coiffeurs || []).length);
  const taken = rdvs.filter((r) => r.day === day && r.status === "confirme");
  const out = [];
  for (let m = open; m + SLOT <= close; m += SLOT) {
    if (m < now) continue;
    const at = taken.filter((r) => r.time === fromMin(m));
    const ok = coiffeurId ? !at.some((r) => r.coiffeurId === coiffeurId) && at.length < n : at.length < n;
    if (ok) out.push(fromMin(m));
  }
  return out;
}

// Fiche client (idée 20) : mise à jour à chaque coupe d'un client dont on a le numéro
function saveClient(phone, name, svName, photo) {
  const id = phoneKey(phone); if (!id || !ME.sid) return;
  Store.getDoc(ME.sid, "clients", id).then((c) => {
    c = c || { name, phone, visits: 0, cuts: {} };
    const cuts = { ...(c.cuts || {}) }; cuts[svName] = (cuts[svName] || 0) + 1;
    const o = { name: name || c.name, phone, visits: (c.visits || 0) + 1, last: dayOf(), cuts };
    if (photo) o.photo = photo;
    return Store.set(ME.sid, "clients", id, o);
  }).catch(() => {});
}
const usual = (c) => Object.entries(c.cuts || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

// ---------- Rendez-vous côté salon (idées 4, 42, 44, 25)
ROUTES.rdv = () => {
  let rows = [], contacts = {};
  viewSubs.push(Store.watch(ME.sid, "rdv", [["day", ">=", dayOf()]], (r) => { rows = r; refresh(); }));
  viewSubs.push(Store.watch(ME.sid, "contacts", [["day", ">=", dayOf()]], (r) => { contacts = Object.fromEntries(r.map((x) => [x.id, x.phone])); refresh(); }));
  $view.innerHTML = `<h1>Rendez-vous</h1>
    <details class="card add" id="r-add-box"><summary>Noter un rendez-vous (appel, WhatsApp)</summary>
      <form id="r-add" data-keep>
        <input class="field" id="r-name" maxlength="30" placeholder="Prénom du client" required>
        <input class="field" id="r-tel" inputmode="tel" maxlength="20" placeholder="Numéro (facultatif)">
        <div class="row"><select class="field" id="r-day" aria-label="Jour"></select><select class="field" id="r-time" aria-label="Heure"></select></div>
        <div class="row"><select class="field" id="r-svc" aria-label="Coupe"></select><select class="field" id="r-coif" aria-label="Coiffeur"></select></div>
        <button class="btn">Enregistrer le rendez-vous</button></form></details>
    <div id="r-list"></div>
    <p class="small muted">Les clients prennent aussi rendez-vous eux-mêmes depuis la page du salon.</p>`;
  const fill = () => {
    const s = LIVE.salon; if (!s) return;
    if (!$("#r-day").options.length) {
      $("#r-day").innerHTML = nextDays(14).map((d) => `<option value="${d}">${dayLabel(d)}</option>`).join("");
      $("#r-svc").innerHTML = services().map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");
      $("#r-coif").innerHTML = `<option value="">Coiffeur : peu importe</option>` + coiffeurs().map((c) => `<option value="${esc(c.id)}"${ME.role === "coiffeur" && c.id === ME.coiffeurId ? " selected" : ""}>${esc(c.name)}</option>`).join("");
    }
    const keep = $("#r-time").value;
    $("#r-time").innerHTML = freeSlots(s, rows, $("#r-day").value, $("#r-coif").value).map((h) => `<option${h === keep ? " selected" : ""}>${h}</option>`).join("") || `<option value="">Complet</option>`;
  };
  $("#r-add").onchange = fill;
  $("#r-add").onsubmit = async (e) => {
    e.preventDefault();
    if (!$("#r-time").value) return toast("Plus de place ce jour-là.");
    const id = await Store.add(ME.sid, "rdv", { day: $("#r-day").value, time: $("#r-time").value, name: $("#r-name").value.trim(), serviceId: $("#r-svc").value, coiffeurId: $("#r-coif").value || null, type: "normal", status: "confirme", at: Date.now(), uid: Store.uid });
    const tel = $("#r-tel").value.trim(); if (tel) Store.set(ME.sid, "contacts", id, { day: $("#r-day").value, phone: tel }).catch(() => {});
    $("#r-name").value = ""; $("#r-tel").value = ""; $("#r-add-box").open = false; toast("Rendez-vous enregistré");
  };
  refreshFn = () => {
    const s = LIVE.salon; if (!s) return;
    fill();
    const mine = ME.role === "coiffeur" ? rows.filter((r) => !r.coiffeurId || r.coiffeurId === ME.coiffeurId) : rows;
    const list = mine.filter((r) => r.status !== "annule").sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
    const days = [...new Set(list.map((r) => r.day))];
    $("#r-list").innerHTML = days.length ? days.map((d) => `<section><h2 class="sec">${dayLabel(d)}</h2><div class="list">${list.filter((r) => r.day === d).map((r) => {
      const sv = svcOf(r.serviceId), c = coifOf(r.coiffeurId), phone = contacts[r.id];
      return `<div class="q-item st-${r.status === "confirme" ? "attente" : "fini"}" data-r="${esc(r.id)}"><span class="num sm-num">${esc(r.time)}</span>
        <div class="q-main"><b>${esc(r.name)}</b><span class="small muted">${esc(sv.name)}${c ? " · " + esc(c.name) : ""}${r.type === "occasion" ? " · " + esc(r.occasion || "Fête") : ""}${r.type === "domicile" ? " · à domicile" : ""}</span>
          ${r.address ? `<span class="small">${esc(r.address)}</span>` : ""}
          ${r.acompte ? `<span class="small ${r.acompte.ok ? "msg-ok" : "warn"}">Acompte ${fcfa(r.acompte.amount)} ${r.acompte.ok ? "reçu" : "à vérifier · réf. " + esc(r.acompte.ref || "?")}</span>` : ""}
          ${r.status !== "confirme" ? `<span class="small muted">${r.status === "fait" ? "Venu" : "Absent"}</span>` : ""}</div>
        <div class="q-act">${r.status === "confirme" ? `${r.acompte && !r.acompte.ok ? `<button class="btn sm alt" data-ra="acompte" type="button">Acompte reçu</button>` : ""}${d === dayOf() ? `<button class="btn sm" data-ra="arrive" type="button">Arrivé</button><button class="btn-ghost sm" data-ra="absent" type="button">Absent</button>` : ""}<button class="btn-ghost sm" data-ra="annule" type="button">Annuler</button>` : ""}
          ${phone ? `<a class="btn-ghost sm" target="_blank" rel="noopener" href="${waLink(phone, `Bonjour ${r.name}, ici ${s.name}. Petit rappel de ton rendez-vous ${dayLabel(r.day).toLowerCase()} à ${r.time}.`)}">WhatsApp</a>` : ""}</div></div>`;
    }).join("")}</div></section>`).join("") : `<p class="empty">Aucun rendez-vous à venir.</p>`;
  };
  $view.onclick = async (ev) => {
    const b = ev.target.closest("[data-ra]"); if (!b) return;
    const r = rows.find((x) => x.id === b.closest("[data-r]").dataset.r); if (!r) return;
    const a = b.dataset.ra;
    if (a === "acompte") Store.update(ME.sid, "rdv", r.id, { acompte: { ...r.acompte, ok: true } });
    if (a === "absent") Store.update(ME.sid, "rdv", r.id, { status: "absent" });
    if (a === "annule") { Store.update(ME.sid, "rdv", r.id, { status: "annule" }); toast("Rendez-vous annulé", () => Store.update(ME.sid, "rdv", r.id, { status: "confirme" })); }
    if (a === "arrive") {
      // le client du rendez-vous passe devant la file
      const num = await Store.nextNumber(ME.sid, dayOf());
      const id = await Store.add(ME.sid, "queue", { day: dayOf(), num, name: r.name, serviceId: r.serviceId, coiffeurId: r.coiffeurId || null, status: "attente", at: Date.now(), uid: Store.uid, rdv: true, walkin: true });
      if (contacts[r.id]) Store.set(ME.sid, "contacts", id, { day: dayOf(), phone: contacts[r.id] }).catch(() => {});
      Store.update(ME.sid, "rdv", r.id, { status: "fait" });
      toast(`${r.name} est dans la file (n° ${num}), en priorité`);
    }
  };
  refresh();
};

// ---------- Prise de rendez-vous par le client (idées 4, 41, 42, 44, 45, 25)
ROUTES.reserver = (sid) => {
  sid = (sid || "").toUpperCase();
  follow(sid, isStaff() && ME.sid === sid ? ME.role : "client");
  let rows = [], ch = { day: dayOf(), coif: "", svc: null, type: "normal", time: "" }, freed = false;
  ME.rdv = ME.rdv || {}; ME.rdv[sid] = (ME.rdv[sid] || []);
  viewSubs.push(Store.watch(sid, "rdv", [["day", ">=", dayOf()]], (r) => { rows = r; refresh(); }));
  $view.innerHTML = `<div id="rv"></div>`;
  refreshFn = () => {
    const s = LIVE.salon; if (!s) return;
    if (!ch.svc && services()[0]) ch.svc = services()[0].id;
    const mine = rows.filter((r) => ME.rdv[sid].includes(r.id) && r.status === "confirme").sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
    const slots = freeSlots(s, rows, ch.day, ch.coif);
    if (ch.time && !slots.includes(ch.time)) ch.time = "";
    // liste d'attente (idée 45) : prévenir si une place se libère le jour voulu
    const w = ME.waitRdv && ME.waitRdv.sid === sid ? ME.waitRdv : null;
    if (w && !freed && freeSlots(s, rows, w.day, w.coif).length) { freed = true; alertMe(s.name, `Une place s'est libérée ${dayLabel(w.day).toLowerCase()}.`); delete ME.waitRdv; saveMe(); }
    const occ = ch.type === "occasion", dom = ch.type === "domicile";
    // garder ce qui est déjà tapé quand la page se redessine
    const typed = Object.fromEntries($$("#rv-f input, #rv-f select").map((i) => [i.id, i.value]));
    $("#rv").innerHTML = `<div class="t-head"><div><h1>Rendez-vous</h1><p class="muted small">${esc(s.name)}${s.ouverture ? ` · ${esc(s.ouverture)} à ${esc(s.fermeture || "")}` : ""}</p></div><a class="btn-ghost sm" href="#ticket/${esc(sid)}">File d'attente</a></div>
      ${mine.length ? `<section><h2 class="sec">Mes rendez-vous</h2><div class="list">${mine.map((r) => `<div class="q-item st-attente" data-m="${esc(r.id)}"><span class="num sm-num">${esc(r.time)}</span><div class="q-main"><b>${dayLabel(r.day)}</b><span class="small muted">${esc(svcOf(r.serviceId).name)}${coifOf(r.coiffeurId) ? " · " + esc(coifOf(r.coiffeurId).name) : ""}</span></div>
        <div class="q-act"><button class="btn sm alt" data-mv="report" type="button">Reporter</button><button class="btn-ghost sm" data-mv="annule" type="button">Annuler</button></div></div>`).join("")}</div></section>` : ""}
      <form id="rv-f" class="card" data-keep>
        <h2>Nouveau rendez-vous</h2>
        <div class="chips" id="rv-type"><button type="button" class="chip" data-v="normal" aria-pressed="${ch.type === "normal"}">Au salon</button><button type="button" class="chip" data-v="occasion" aria-pressed="${occ}">Grande occasion</button>${s.domicile ? `<button type="button" class="chip" data-v="domicile" aria-pressed="${dom}">À domicile (+${fcfa(s.domicileExtra ?? 1000)})</button>` : ""}</div>
        ${occ ? `<select class="field" id="rv-occ" aria-label="Occasion">${OCCASIONS.map((o) => `<option>${o}</option>`).join("")}</select>
          <p class="small">Un acompte de <b>${fcfa(s.acompte || 2000)}</b> réserve la place : envoie-le par Wave au <b class="code">${esc(s.tel || "numéro du salon")}</b>, puis écris la référence du transfert.</p>
          <input class="field" id="rv-ref" maxlength="40" placeholder="Référence Wave du transfert" required>` : ""}
        ${dom ? `<input class="field" id="rv-addr" maxlength="80" placeholder="Adresse (quartier, rue, repère)" required>` : ""}
        <span class="lbl">Coupe</span>
        <div class="chips" id="rv-svc">${services().map((x) => `<button type="button" class="chip" data-v="${esc(x.id)}" aria-pressed="${ch.svc === x.id}">${esc(x.name)}${x.express ? " ⚡" : ""} · ${fcfa(x.price)}</button>`).join("")}</div>
        ${coiffeurs().length > 1 ? `<span class="lbl">Coiffeur</span><div class="chips" id="rv-coif"><button type="button" class="chip" data-v="" aria-pressed="${!ch.coif}">Peu importe</button>${coiffeurs().map((c) => `<button type="button" class="chip" data-v="${esc(c.id)}" aria-pressed="${ch.coif === c.id}">${esc(c.name)}</button>`).join("")}</div>` : ""}
        <span class="lbl">Jour</span>
        <div class="chips scroll" id="rv-day">${nextDays(14).map((d) => `<button type="button" class="chip" data-v="${d}" aria-pressed="${ch.day === d}">${dayLabel(d)}</button>`).join("")}</div>
        <span class="lbl">Heure</span>
        ${slots.length ? `<div class="chips" id="rv-time">${slots.map((h) => `<button type="button" class="chip" data-v="${h}" aria-pressed="${ch.time === h}">${h}</button>`).join("")}</div>`
          : `<p class="empty">Plus de place ce jour-là.</p><button type="button" class="btn alt" id="rv-wait">Me prévenir si une place se libère</button>`}
        <label class="lbl" for="rv-name">Ton prénom</label><input class="field" id="rv-name" maxlength="30" required value="${esc(ME.name || "")}">
        <label class="lbl" for="rv-tel">Ton numéro</label><input class="field" id="rv-tel" inputmode="tel" maxlength="20" required value="${esc(ME.tel || "")}">
        <button class="btn big">${ch.report ? "Déplacer mon rendez-vous" : "Réserver"}</button><p class="small" id="rv-msg"></p></form>`;
    Object.entries(typed).forEach(([id, v]) => { const el = document.getElementById(id); if (el && v) el.value = v; });
    const pick = (id, key) => { const el = $(id); if (el) el.onclick = (e) => { const b = e.target.closest("[data-v]"); if (b) { ch[key] = b.dataset.v; refresh(); } }; };
    pick("#rv-type", "type"); pick("#rv-svc", "svc"); pick("#rv-coif", "coif"); pick("#rv-day", "day"); pick("#rv-time", "time");
    const wb = $("#rv-wait"); if (wb) wb.onclick = () => { ME.waitRdv = { sid, day: ch.day, coif: ch.coif }; freed = false; saveMe(); toast("Garde cette page ouverte : le téléphone vibrera si une place se libère."); };
    $("#rv-f").onsubmit = async (e) => {
      e.preventDefault();
      if (!ch.time) { $("#rv-msg").textContent = "Choisis une heure."; return; }
      const name = $("#rv-name").value.trim(), tel = $("#rv-tel").value.trim();
      ME.name = name; ME.tel = tel; saveMe();
      try {
        const u = await Store.ensureUser();
        if (ch.report) {
          await Store.update(sid, "rdv", ch.report, { day: ch.day, time: ch.time });
          ch.report = null; toast("Rendez-vous déplacé"); return refresh();
        }
        const o = { day: ch.day, time: ch.time, name, serviceId: ch.svc, coiffeurId: ch.coif || null, type: ch.type, status: "confirme", at: Date.now(), uid: u };
        if (occ) { o.occasion = $("#rv-occ").value; o.acompte = { amount: s.acompte || 2000, ref: $("#rv-ref").value.trim(), ok: false }; }
        if (dom) o.address = $("#rv-addr").value.trim();
        const id = await Store.add(sid, "rdv", o);
        Store.set(sid, "contacts", id, { day: ch.day, phone: tel }).catch(() => {});
        ME.rdv[sid].push(id); saveMe(); ch.time = ""; toast(`Rendez-vous réservé : ${dayLabel(o.day).toLowerCase()} à ${o.time}`); refresh();
      } catch (er) { $("#rv-msg").className = "small msg-ko"; $("#rv-msg").textContent = "Réservation impossible. Vérifie le réseau."; }
    };
  };
  // annulation et report en un geste (idée 44)
  $view.onclick = (ev) => {
    const b = ev.target.closest("[data-mv]"); if (!b) return;
    const r = rows.find((x) => x.id === b.closest("[data-m]").dataset.m); if (!r) return;
    if (b.dataset.mv === "annule") { Store.update(sid, "rdv", r.id, { status: "annule" }); toast("Rendez-vous annulé"); }
    else { Object.assign(ch, { report: r.id, day: r.day, svc: r.serviceId, coif: r.coiffeurId || "", time: "" }); toast("Choisis le nouveau jour et la nouvelle heure"); refresh(); }
  };
  refresh();
};

// ---------- Fiches clients et relances (idées 20, 21)
ROUTES.clients = () => {
  let rows = [], q = "", late = false;
  viewSubs.push(Store.watch(ME.sid, "clients", [], (r) => { rows = r; refresh(); }));
  $view.innerHTML = `<h1>Mes clients</h1>
    <div class="row" data-keep><input class="field" id="cl-q" placeholder="Chercher un prénom ou un numéro" autocomplete="off"></div>
    <div class="chips"><button type="button" class="chip" id="cl-all" aria-pressed="true">Tous</button><button type="button" class="chip" id="cl-late" aria-pressed="false">À relancer (3 semaines et plus)</button></div>
    <div id="cl-list" class="list"></div>
    <p class="small muted">Une fiche se crée à chaque coupe d'un client qui a donné son numéro (ticket ou rendez-vous).</p>`;
  $("#cl-q").oninput = (e) => { q = e.target.value.trim().toLowerCase(); paint(); };
  $("#cl-all").onclick = () => { late = false; paint(); }; $("#cl-late").onclick = () => { late = true; paint(); };
  const paint = () => {
    const s = LIVE.salon || {}, lim = dayOf(Date.now() - 21 * 864e5);
    $("#cl-all").setAttribute("aria-pressed", !late); $("#cl-late").setAttribute("aria-pressed", late);
    const list = rows.filter((c) => (!q || (c.name || "").toLowerCase().includes(q) || (c.phone || "").includes(q)) && (!late || (c.last || "") <= lim)).sort((a, b) => (b.last || "").localeCompare(a.last || ""));
    $("#cl-list").innerHTML = list.length ? list.map((c) => {
      const weeks = Math.floor((Date.now() - new Date((c.last || dayOf()) + "T12:00")) / (7 * 864e5));
      return `<div class="v-item">${c.photo ? `<img class="cl-ph" src="${c.photo}" alt="">` : ""}<div class="q-main"><b>${esc(c.name)}</b><span class="small muted">${c.visits} visite${c.visits > 1 ? "s" : ""} · dernière ${c.last ? dayLabel(c.last).toLowerCase() : "?"}${usual(c) ? " · " + esc(usual(c)) : ""}</span></div>
        <a class="btn-ghost sm" target="_blank" rel="noopener" href="${waLink(c.phone, `Bonjour ${c.name}, ça fait ${weeks >= 3 ? weeks + " semaines" : "un moment"} ! Il est temps de repasser chez ${s.name || "nous"}${usual(c) ? " pour ton " + usual(c).toLowerCase() : ""}. Prends ton ticket ici : ${ticketUrl(ME.sid)}`)}">${weeks >= 3 ? "Relancer" : "WhatsApp"}</a></div>`;
    }).join("") : `<p class="empty">${late ? "Aucun client à relancer." : "Aucune fiche client pour le moment."}</p>`;
  };
  refreshFn = paint;
  refresh();
};

// ---------- Offres de fêtes (idée 22)
ROUTES.offres = () => {
  $view.innerHTML = `<h1>Offres</h1><p class="muted">Tabaski, Korité, fin d'année, rentrée : l'offre s'affiche sur la page du salon et sur le ticket des clients.</p>
    <form class="card" id="of-f" data-keep>
      <div class="chips" id="of-ideas">${["Tabaski", "Korité", "Fin d'année", "Rentrée"].map((x) => `<button type="button" class="chip" data-v="${x}">${x}</button>`).join("")}</div>
      <input class="field" id="of-title" maxlength="40" placeholder="Titre (ex. Spécial Tabaski)" required>
      <input class="field" id="of-text" maxlength="120" placeholder="Offre (ex. Coupe + barbe à 1 500 F jusqu'à la veille)" required>
      <label class="lbl" for="of-until">Jusqu'au</label><input class="field" id="of-until" type="date">
      <button class="btn">Publier l'offre</button></form><div id="of-list" class="list"></div>`;
  $("#of-ideas").onclick = (e) => { const b = e.target.closest("[data-v]"); if (b) { $("#of-title").value = "Spécial " + b.dataset.v; $("#of-text").focus(); } };
  $("#of-f").onsubmit = (e) => {
    e.preventDefault();
    const o = { id: uid(), title: $("#of-title").value.trim(), text: $("#of-text").value.trim(), until: $("#of-until").value || "" };
    Store.updateSalon(ME.sid, { offres: (LIVE.salon.offres || []).concat(o) }); e.target.reset(); toast("Offre publiée");
  };
  $view.onclick = (e) => { const b = e.target.closest("[data-of]"); if (b) Store.updateSalon(ME.sid, { offres: (LIVE.salon.offres || []).filter((o) => o.id !== b.dataset.of) }); };
  refreshFn = () => {
    const s = LIVE.salon; if (!s) return;
    const list = s.offres || [];
    $("#of-list").innerHTML = list.length ? list.map((o) => `<div class="v-item"><div class="q-main"><b>${esc(o.title)}</b><span class="small">${esc(o.text)}</span><span class="small muted">${o.until ? (o.until >= dayOf() ? "Jusqu'au " + new Date(o.until + "T12:00").toLocaleDateString("fr-FR") : "Terminée") : "Sans date de fin"}</span></div>
      <a class="btn-ghost sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${s.name} : ${o.title}. ${o.text} Prends ton ticket : ${ticketUrl(ME.sid)}`)}">Partager</a><button type="button" class="btn-ghost sm" data-of="${esc(o.id)}" aria-label="Supprimer l'offre">✕</button></div>`).join("") : `<p class="empty">Aucune offre en cours.</p>`;
  };
  refresh();
};
const offersHtml = (s) => activeOffers(s).map((o) => `<div class="offer"><b>${esc(o.title)}</b><span>${esc(o.text)}</span></div>`).join("");

// ---------- Page du salon à partager (idées 27, 76, 78)
const pageUrl = (sid) => `${baseUrl()}#page/${sid}`;
const mapUrl = (s) => s.lat ? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.name + " " + (s.quartier || ""))}`;
ROUTES.page = (sid) => {
  sid = (sid || "").toUpperCase();
  follow(sid, isStaff() && ME.sid === sid ? ME.role : "client");
  let gal = [];
  viewSubs.push(Store.watch(sid, "galerie", [], (r) => { gal = r.sort((a, b) => b.at - a.at).slice(0, 6); refresh(); }));
  refreshFn = () => {
    const s = LIVE.salon;
    if (s === null && LIVE.sid === sid) { $view.innerHTML = `<h1>Salon introuvable</h1><a class="btn alt" href="#annuaire">Voir les salons</a>`; return; }
    if (!s) return;
    const w = waiting().length;
    $view.innerHTML = `<div class="t-head"><div><h1>${esc(s.name)}</h1><p class="muted small">${esc(s.quartier || "")}</p></div><span class="open-tog ${s.open ? "on" : ""}">${s.open ? "Ouvert" : "Fermé"}</span></div>
      ${s.horaires || s.ouverture ? `<p>${esc(s.horaires || `Tous les jours de ${s.ouverture} à ${s.fermeture}`)}</p>` : ""}
      ${offersHtml(s)}
      ${s.open ? `<div class="kpis"><div><b>${w}</b><span>en attente maintenant</span></div><div><b>${waitLabel(estimate()._next)}</b><span>d'attente estimée</span></div></div>` : ""}
      <div class="row"><a class="btn" href="#ticket/${esc(sid)}">Prendre un ticket</a><a class="btn alt" href="#reserver/${esc(sid)}">Prendre rendez-vous</a></div>
      <section class="card"><h2>Coupes et prix</h2><div class="list">${services().map((x) => `<div class="v-item">${x.photo ? `<img class="cl-ph" src="${x.photo}" alt="">` : ""}<div class="q-main"><b>${esc(x.name)}${x.express ? ` <span class="pill">Express</span>` : ""}</b><span class="small muted">${x.dur} min</span></div><b class="tab">${fcfa(x.price)}</b></div>`).join("")}</div>
        ${s.domicile ? `<p class="small">Service à domicile sur rendez-vous (+${fcfa(s.domicileExtra ?? 1000)}).</p>` : ""}</section>
      ${gal.length ? `<section><h2 class="sec">Nos réalisations</h2><div class="gal">${gal.map((g) => `<figure><img src="${g.img}" alt="Coupe réalisée au salon"></figure>`).join("")}</div><a class="btn-ghost" href="#galerie/${esc(sid)}">Voir toutes les photos</a></section>` : ""}
      <div class="row"><a class="btn alt" target="_blank" rel="noopener" href="${mapUrl(s)}">Itinéraire</a><button class="btn alt" type="button" id="pg-share">Partager la page</button>${s.tel ? `<a class="btn-ghost" href="${waLink(s.tel, "Bonjour " + s.name + ",")}" target="_blank" rel="noopener">WhatsApp du salon</a>` : ""}</div>
      <div class="qr-print small-qr">${qrSvg(pageUrl(sid), 160)}<span class="code">${esc(sid)}</span></div>`;
    $("#pg-share").onclick = async () => {
      const text = `${s.name} (${s.quartier || ""}) : prix, attente en direct et rendez-vous`;
      try { if (navigator.share) return await navigator.share({ title: s.name, text, url: pageUrl(sid) }); } catch (er) { if (er.name === "AbortError") return; }
      window.open(`https://wa.me/?text=${encodeURIComponent(text + " " + pageUrl(sid))}`, "_blank", "noopener");
    };
  };
  idle = setInterval(refresh, 30000);
  refresh();
};

// ---------- Annuaire des salons du quartier (idée 26)
ROUTES.annuaire = () => {
  let rows = [], q = "", pos = null;
  viewSubs.push(Store.watchDirectory((r) => { rows = r; refresh(); }));
  $view.innerHTML = `<h1>Les salons</h1><p class="muted">Salons inscrits dans l'annuaire, avec l'attente et les prix.</p>
    <div class="row" data-keep><input class="field" id="an-q" placeholder="Quartier ou nom du salon" autocomplete="off"><button class="btn alt" type="button" id="an-near">Près de moi</button></div>
    <div id="an-list" class="list"></div><a class="btn-ghost" href="#accueil">Retour à l'accueil</a>`;
  $("#an-q").oninput = (e) => { q = e.target.value.trim().toLowerCase(); paint(); };
  $("#an-near").onclick = () => {
    if (!navigator.geolocation) return toast("La position n'est pas disponible sur ce téléphone.");
    navigator.geolocation.getCurrentPosition((p) => { pos = [p.coords.latitude, p.coords.longitude]; paint(); }, () => toast("Position refusée."), { timeout: 10000 });
  };
  const km = (s) => { if (!pos || !s.lat) return null; const R = 6371, r = Math.PI / 180, dLa = (s.lat - pos[0]) * r, dLo = (s.lng - pos[1]) * r; const a = Math.sin(dLa / 2) ** 2 + Math.cos(pos[0] * r) * Math.cos(s.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); };
  const paint = () => {
    const list = rows.filter((s) => !q || (s.name + " " + (s.quartier || "")).toLowerCase().includes(q)).map((s) => ({ s, d: km(s) })).sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9) || (b.s.open - a.s.open));
    $("#an-list").innerHTML = list.length ? list.map(({ s, d }) => {
      const min = Math.min(...(s.services || []).map((x) => x.price).filter(Boolean));
      return `<a class="v-item dir" href="#page/${esc(s.id)}"><div class="q-main"><b>${esc(s.name)}</b><span class="small muted">${esc(s.quartier || "")}${d != null ? ` · ${d < 1 ? Math.round(d * 1000) + " m" : d.toFixed(1) + " km"}` : ""}${isFinite(min) ? ` · dès ${fcfa(min)}` : ""}</span></div><span class="open-tog sm ${s.open ? "on" : ""}">${s.open ? "Ouvert" : "Fermé"}</span></a>`;
    }).join("") : `<p class="empty">Aucun salon trouvé.</p>`;
  };
  refreshFn = paint;
  refresh();
};
