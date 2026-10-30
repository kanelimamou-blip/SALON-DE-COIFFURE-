"use strict";
// Données des salons, dans Firestore (cache sur le téléphone pour marcher sans connexion).
//
// salons/{sid}                      nom, quartier, services, coiffeurs, ouvert, owner, created, premiumUntil
// salons/{sid}/private/config       code coiffeur (lisible par le patron seul)
// salons/{sid}/staff/{uid}          coiffeur relié à ce téléphone
// salons/{sid}/queue/{id}           tickets de la file (jour, numéro, prénom, coupe, statut)
// salons/{sid}/contacts/{id}        numéro du client d'un ticket (patron et coiffeurs seulement)
// salons/{sid}/ventes|depenses|stock|pointage|galerie/{id}
// salons/{sid}/meta/counter         dernier numéro de ticket du jour
// paiements/{id}                    « j'ai payé » d'un salon, validé par un admin

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
      await ref.set({ ...data, owner: user.uid, created: FV.serverTimestamp(), premiumUntil: 0 });
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
  async function add(sid, col, obj) {
    const ref = S(sid).collection(col).doc();
    ref.set(obj).catch(() => {});   // sans attendre : hors connexion, l'écriture part plus tard
    return ref.id;
  }
  const set = (sid, col, id, obj) => S(sid).collection(col).doc(id).set(obj);
  async function update(sid, col, id, patch) { S(sid).collection(col).doc(id).update(patch).catch(() => {}); }
  async function remove(sid, col, id) { S(sid).collection(col).doc(id).delete().catch(() => {}); }
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

  async function declarePayment(rec) {
    await db.collection("paiements").add({ ...rec, uid: user.uid, at: FV.serverTimestamp(), status: "attente" });
  }
  const watchPayments = (cb) => db.collection("paiements").where("status", "==", "attente").onSnapshot((s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]));
  async function validatePayment(p, until) {
    const b = db.batch();
    b.update(S(p.sid), { premiumUntil: until });
    b.update(db.collection("paiements").doc(p.id), { status: "valide" });
    await b.commit();
  }

  return {
    init, ensureUser, signIn, signInEmail, signOut, isAccount,
    get uid() { return user ? user.uid : null; },
    get email() { return user ? user.email || "" : ""; },
    createSalon, watchSalon, getSalon, updateSalon, mySalons, watchDirectory,
    watch, add, set, update, remove, getDoc, nextNumber,
    staffCode, newStaffCode, joinStaff, declarePayment, watchPayments, validatePayment,
  };
})();
