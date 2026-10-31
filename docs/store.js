"use strict";
// Données des salons, dans Firestore (cache sur le téléphone pour marcher sans connexion).
//
// salons/{sid}                      nom, quartier, services, coiffeurs, ouvert, owner, created, blocked (suspendu par l'admin)
// salons/{sid}/private/config       code coiffeur (lisible par le patron seul)
// salons/{sid}/staff/{uid}          coiffeur relié à ce téléphone
// salons/{sid}/queue/{id}           tickets de la file (jour, numéro, prénom, coupe, statut)
// salons/{sid}/contacts/{id}        numéro du client d'un ticket (patron et coiffeurs seulement)
// salons/{sid}/ventes|depenses|stock|pointage|galerie/{id}
// salons/{sid}/meta/counter         dernier numéro de ticket du jour
// salons/{sid}/credits|messages/{id} coupes à crédit ; messages entre le patron et l'équipe de l'appli
// erreurs/{id}                     erreurs remontées par les téléphones (lues par l'admin seulement)
// base/{numéro}                    patrons et clients inscrits avec leur numéro (lus par l'admin seulement)
// invitations|paiements|journal/{id}  espace admin : invitations envoyées, abonnements notés à la main, actions faites
// appareils/{uid}                  version de l'appli et temps de chargement de chaque téléphone
// admin/config                     associés (admins en lecture seule)
// espace admin : lecture de tous les salons, blocked modifiable par les admins seulement

const Store = (() => {
  const code = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join("");
  const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
  let auth = null, db = null, FV = null, user = null;
  const loadJs = (src) => new Promise((ok, ko) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  const S = (sid) => db.collection("salons").doc(sid);
  const fromDoc = (d) => { const o = d.data(); if (o.created && o.created.toMillis) o.created = o.created.toMillis(); return { id: d.id, ...o }; };

  async function init() {
    await loadJs(SDK + "firebase-app-compat.js");
    await Promise.all([loadJs(SDK + "firebase-auth-compat.js"), loadJs(SDK + "firebase-firestore-compat.js")]);
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth(); db = firebase.firestore(); FV = firebase.firestore.FieldValue;
    // tests : émulateurs Firebase locaux
    if (window.SALON_EMU) { auth.useEmulator("http://127.0.0.1:9099"); db.useEmulator("127.0.0.1", 8080); }
    // mode hors connexion (idée 65) : lectures depuis le cache, écritures envoyées au retour du réseau
    await db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    await auth.getRedirectResult().catch(() => null);
    user = await new Promise((ok) => { const off = auth.onAuthStateChanged((u) => { off(); ok(u); }); });
  }

  // Le client et le coiffeur n'ont pas besoin de compte : connexion anonyme
  async function ensureUser() {
    if (!user) user = (await auth.signInAnonymously()).user;
    return user.uid;
  }
  async function signIn() {
    const p = new firebase.auth.GoogleAuthProvider();
    try { await auth.signInWithPopup(p); } catch (e) { if (/popup|operation-not-supported/.test(e.code || "")) return auth.signInWithRedirect(p); throw e; }
    user = auth.currentUser; return user;
  }
  async function signInEmail(email, pass, create) {
    user = (create ? await auth.createUserWithEmailAndPassword(email, pass) : await auth.signInWithEmailAndPassword(email, pass)).user;
    return user;
  }
  async function signOut() { if (auth) await auth.signOut(); user = null; }
  const isAccount = () => !!(user && !user.isAnonymous);

  async function createSalon(data) {
    for (let i = 0; i < 5; i++) {
      const sid = code(5), ref = S(sid);
      if ((await ref.get().catch(() => null))?.exists) continue;
      await ref.set({ ...data, owner: user.uid, created: FV.serverTimestamp() });
      await ref.collection("private").doc("config").set({ staffCode: code(4) });
      return sid;
    }
    throw new Error("Création impossible, réessaie.");
  }
  const watchSalon = (sid, cb, err) => S(sid).onSnapshot((d) => cb(d.exists ? fromDoc(d) : null), err || (() => cb(null)));
  async function getSalon(sid) { const d = await S(sid).get(); return d.exists ? fromDoc(d) : null; }
  const updateSalon = (sid, patch) => S(sid).update(patch);
  // annuaire (idée 26) : salons qui ont choisi d'y figurer
  const watchDirectory = (cb) => db.collection("salons").where("annuaire", "==", true).onSnapshot((q) => cb(q.docs.map(fromDoc)), () => cb([]));
  async function mySalons() {
    if (!isAccount()) return [];
    const q = await db.collection("salons").where("owner", "==", user.uid).get();
    return q.docs.map(fromDoc);
  }

  function watch(sid, col, where, cb, err) {
    let q = S(sid).collection(col);
    (where || []).forEach(([f, op, v]) => { q = q.where(f, op, v); });
    return q.onSnapshot((snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), err || (() => {}));
  }
  // Une écriture refusée par le serveur est signalée à l'appli (sinon elle disparaît sans bruit)
  const refused = (e) => { window.dispatchEvent(new CustomEvent("store-refused", { detail: e })); throw e; };
  // Avec confirm, on attend la réponse du serveur quelques secondes : refus = erreur ; sans réseau = gardé pour plus tard
  const settle = (p, confirm) => {
    p = p.catch(refused);
    if (!confirm) { p.catch(() => {}); return Promise.resolve(); }
    return Promise.race([p.then(() => "ok"), new Promise((ok) => setTimeout(() => ok("plus tard"), 6000))]);
  };
  async function add(sid, col, obj, confirm) {
    const ref = S(sid).collection(col).doc();
    await settle(ref.set(obj), confirm);
    return ref.id;
  }
  const set = (sid, col, id, obj, confirm) => settle(S(sid).collection(col).doc(id).set(obj), confirm);
  const merge = (sid, col, id, obj) => settle(S(sid).collection(col).doc(id).set(obj, { merge: true }));
  const update = (sid, col, id, patch, confirm) => settle(S(sid).collection(col).doc(id).update(patch), confirm);
  const remove = (sid, col, id) => settle(S(sid).collection(col).doc(id).delete());
  async function getDoc(sid, col, id) { const d = await S(sid).collection(col).doc(id).get(); return d.exists ? { id, ...d.data() } : null; }

  // Numéro de ticket du jour, sans doublon même si deux clients le prennent en même temps
  function nextNumber(sid, day) {
    const ref = S(sid).collection("meta").doc("counter");
    return db.runTransaction(async (t) => {
      const d = await t.get(ref);
      const n = d.exists && d.data().day === day ? d.data().n + 1 : 1;
      t.set(ref, { day, n }); return n;
    });
  }

  async function staffCode(sid) { const d = await getDoc(sid, "private", "config"); return d ? d.staffCode : ""; }
  async function newStaffCode(sid) { const c = code(4); await set(sid, "private", "config", { staffCode: c }); return c; }
  // Un coiffeur relie son téléphone au salon avec le code donné par le patron
  async function joinStaff(sid, codeIn, coiffeurId) {
    const uid = await ensureUser();
    await S(sid).collection("staff").doc(uid).set({ coiffeurId, code: codeIn });
  }

  // Collections hors salon (base des numéros, espace admin)
  const T = (col) => db.collection(col);
  const rows = (q) => q.docs.map((d) => ({ id: d.id, ...d.data() }));
  const addTop = (col, obj) => settle(T(col).add(obj));
  async function addTopRef(col, obj) { const ref = T(col).doc(); await settle(ref.set(obj), true); return ref.id; }
  const setTop = (col, id, obj, merge) => settle(T(col).doc(id).set(obj, { merge: !!merge }));
  const updateTop = (col, id, patch) => settle(T(col).doc(id).update(patch));
  const removeTop = (col, id) => settle(T(col).doc(id).delete());
  async function getTop(col, id) { const d = await T(col).doc(id).get(); return d.exists ? { id, ...d.data() } : null; }
  function watchTop(col, cb, opt = {}) {
    let q = T(col);
    (opt.where || []).forEach(([f, op, v]) => { q = q.where(f, op, v); });
    if (opt.order) q = q.orderBy(opt.order, "desc");
    if (opt.limit) q = q.limit(opt.limit);
    return q.onSnapshot((snap) => cb(rows(snap)), opt.err || (() => cb([])));
  }
  // lecture unique d'une sous-collection d'un salon (comparaisons de mois, courbes)
  async function list(sid, col, where) {
    let q = S(sid).collection(col);
    (where || []).forEach(([f, op, v]) => { q = q.where(f, op, v); });
    return rows(await q.get());
  }
  // Inscription par numéro (base de numéros de l'appli) : patron à la création du salon, client à son ticket ou rendez-vous
  function inscrire(tel, nom, role, sid) {
    const key = String(tel || "").replace(/\D/g, "").replace(/^221/, "").slice(-9);
    if (key.length < 7 || !user) return Promise.resolve();
    return T("base").doc(key).set({ tel: key, nom: String(nom || "").slice(0, 40), [role]: true, sids: FV.arrayUnion(sid || ""), last: Date.now(), n: FV.increment(1) }, { merge: true }).catch(() => {});
  }
  // Coiffeurs reliés : le patron retire le téléphone d'un coiffeur qui part
  async function unlinkStaff(sid, coiffeurId) {
    let q = S(sid).collection("staff"); if (coiffeurId) q = q.where("coiffeurId", "==", coiffeurId);
    const docs = (await q.get()).docs; await Promise.all(docs.map((d) => d.ref.delete())); return docs.length;
  }
  // Reprise d'un salon par un nouveau patron, avec le code de transfert créé par l'admin
  async function claimSalon(sid, codeIn) {
    await S(sid).update({ owner: user.uid, claim: codeIn });
    await S(sid).collection("private").doc("transfer").delete().catch(() => {});
  }

  // Espace admin : tous les salons, et l'activité récente d'un salon (tickets et rendez-vous, données publiques)
  const watchAllSalons = (cb, err) => db.collection("salons").orderBy("created", "desc").onSnapshot((q) => cb(q.docs.map(fromDoc)), err || (() => cb([])));
  async function activity(sid, since) {
    const hier = new Date(Date.now() - 864e5), y = `${hier.getFullYear()}-${String(hier.getMonth() + 1).padStart(2, "0")}-${String(hier.getDate()).padStart(2, "0")}`;
    const [q, r, v] = await Promise.all([S(sid).collection("queue").where("day", ">=", since).get(), S(sid).collection("rdv").where("day", ">=", since).get(),
      S(sid).collection("ventes").where("day", ">=", since).get().catch(() => null)]);
    const qd = q.docs.map((d) => d.data().day), vd = v ? v.docs.map((d) => d.data().day) : [];
    return { tickets: q.size, rdv: r.size, ventes: v ? v.size : null, hierT: qd.filter((d) => d === y).length, hierV: vd.filter((d) => d === y).length, last: qd.sort().pop() || "" };
  }
  // Courbe sur 30 jours et fonctions vraiment utilisées par un salon
  async function usage(sid, since) {
    const one = (col) => S(sid).collection(col).limit(1).get().then((x) => x.size > 0, () => false);
    const [q, v, r, f] = await Promise.all([S(sid).collection("queue").where("day", ">=", since).get(), S(sid).collection("ventes").where("day", ">=", since).get().catch(() => ({ docs: [] })),
      S(sid).collection("rdv").where("day", ">=", since).get(), Promise.all(["clients", "depenses", "stock", "galerie", "credits"].map(one))]);
    const days = {}; const add = (d, k) => { days[d] = days[d] || { t: 0, v: 0, r: 0 }; days[d][k]++; };
    q.docs.forEach((d) => add(d.data().day, "t")); v.docs.forEach((d) => add(d.data().day, "v")); r.docs.forEach((d) => add(d.data().day, "r"));
    const [clients, depenses, stock, galerie, credits] = f;
    return { days, used: { file: q.size > 0, caisse: v.docs.length > 0, rdv: r.size > 0, clients, depenses, stock, galerie, credits } };
  }
  // Erreurs vues sur les téléphones, pour que l'admin repère un problème avant qu'on le lui signale
  let sent = 0;
  async function logError(e) {
    if (!db || sent >= 5) return;
    sent++;
    await ensureUser().catch(() => {});
    if (!user) return;
    await db.collection("erreurs").add({ ...e, at: Date.now(), uid: user.uid }).catch(() => {});
  }
  const watchErrors = (since, cb, err) => db.collection("erreurs").where("at", ">=", since).orderBy("at", "desc").limit(100).onSnapshot((q) => cb(q.docs.map((d) => ({ id: d.id, ...d.data() }))), err || (() => cb([])));
  const removeError = (id) => db.collection("erreurs").doc(id).delete();

  return {
    init, ensureUser, signIn, signInEmail, signOut, isAccount,
    get uid() { return user ? user.uid : null; },
    get email() { return user ? user.email || "" : ""; },
    createSalon, watchSalon, getSalon, updateSalon, mySalons, watchDirectory,
    watch, add, set, merge, update, remove, getDoc, nextNumber,
    staffCode, newStaffCode, joinStaff, watchAllSalons, activity, usage, logError, watchErrors, removeError,
    addTop, addTopRef, setTop, updateTop, removeTop, getTop, watchTop, list, inscrire, unlinkStaff, claimSalon,
  };
})();
