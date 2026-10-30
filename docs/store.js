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
// erreurs/{id}                     erreurs remontées par les téléphones (lues par l'admin seulement)
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

  // Espace admin : tous les salons, et l'activité récente d'un salon (tickets et rendez-vous, données publiques)
  const watchAllSalons = (cb, err) => db.collection("salons").orderBy("created", "desc").onSnapshot((q) => cb(q.docs.map(fromDoc)), err || (() => cb([])));
  async function activity(sid, since) {
    const [q, r] = await Promise.all([S(sid).collection("queue").where("day", ">=", since).get(), S(sid).collection("rdv").where("day", ">=", since).get()]);
    return { tickets: q.size, rdv: r.size, last: q.docs.map((d) => d.data().day).sort().pop() || "" };
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
    watch, add, set, update, remove, getDoc, nextNumber,
    staffCode, newStaffCode, joinStaff, watchAllSalons, activity, logError, watchErrors, removeError,
  };
})();
