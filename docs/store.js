"use strict";
// Données des salons : Firestore quand FIREBASE_CONFIG est rempli, sinon le téléphone seul (mode démo).
// Les deux modes ont la même interface, l'appli ne voit pas la différence.
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
  const cloud = !!FIREBASE_CONFIG;
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (x) => "abcdefghijkmnpqrstuvwxyz23456789"[x % 32]).join("");
  const code = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join("");
  const match = (o, where) => (where || []).every(([f, op, v]) => op === "==" ? o[f] === v : op === ">=" ? o[f] >= v : op === "<=" ? o[f] <= v : true);

  // ---------- Mode démo : localStorage, et les autres onglets suivent par BroadcastChannel
  const KEY = "salon-db";
  let mem = null;
  const load = () => { try { mem = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { mem = mem || {}; } return mem; };
  const watchers = new Set();
  let bc = null;
  try { bc = new BroadcastChannel(KEY); bc.onmessage = () => { load(); watchers.forEach((w) => w()); }; } catch (e) {}
  window.addEventListener("storage", (e) => { if (e.key === KEY) { load(); watchers.forEach((w) => w()); } });
  function commit() {
    try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) {}
    if (bc) bc.postMessage(1);
    watchers.forEach((w) => setTimeout(w));
  }
  const L = (sid) => { load(); return (mem[sid] = mem[sid] || { doc: null }); };
  const Lcol = (sid, col) => { const s = L(sid); return (s[col] = s[col] || {}); };
  const lwatch = (fn) => { watchers.add(fn); fn(); return () => watchers.delete(fn); };
  const LOCAL_UID = (() => { try { let u = localStorage.getItem("salon-uid"); if (!u) { u = "local-" + rid(); localStorage.setItem("salon-uid", u); } return u; } catch (e) { return "local-x"; } })();

  // ---------- Mode en ligne : Firestore avec cache hors connexion
  const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
  let auth = null, db = null, FV = null, user = null;
  const loadJs = (src) => new Promise((ok, ko) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  const S = (sid) => db.collection("salons").doc(sid);
  const fromDoc = (d) => { const o = d.data(); if (o.created && o.created.toMillis) o.created = o.created.toMillis(); return { id: d.id, ...o }; };

  async function init() {
    if (!cloud) return;
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
    if (!cloud) return LOCAL_UID;
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
  const isAccount = () => !cloud || (user && !user.isAnonymous);

  // ---------- Interface commune
  async function createSalon(data) {
    const uid = cloud ? user.uid : LOCAL_UID;
    for (let i = 0; i < 5; i++) {
      const sid = code(5);
      const staffCode = code(4);
      if (!cloud) {
        if (L(sid).doc) continue;
        mem[sid] = { doc: { ...data, owner: uid, created: Date.now(), premiumUntil: 0 }, private: { config: { staffCode } } };
        commit(); return sid;
      }
      const ref = S(sid);
      if ((await ref.get().catch(() => null))?.exists) continue;
      await ref.set({ ...data, owner: uid, created: FV.serverTimestamp(), premiumUntil: 0 });
      await ref.collection("private").doc("config").set({ staffCode });
      return sid;
    }
    throw new Error("Création impossible, réessaie.");
  }

  function watchSalon(sid, cb, err) {
    if (!cloud) return lwatch(() => { const d = L(sid).doc; cb(d ? { id: sid, ...d } : null); });
    return S(sid).onSnapshot((d) => cb(d.exists ? fromDoc(d) : null), err || (() => cb(null)));
  }
  async function getSalon(sid) {
    if (!cloud) { const d = L(sid).doc; return d ? { id: sid, ...d } : null; }
    const d = await S(sid).get(); return d.exists ? fromDoc(d) : null;
  }
  async function updateSalon(sid, patch) {
    if (!cloud) { Object.assign(L(sid).doc, patch); commit(); return; }
    await S(sid).update(patch);
  }
  async function mySalons() {
    if (!cloud) { load(); return Object.entries(mem).filter(([, s]) => s.doc && s.doc.owner === LOCAL_UID).map(([id, s]) => ({ id, ...s.doc })); }
    if (!user || user.isAnonymous) return [];
    const q = await db.collection("salons").where("owner", "==", user.uid).get();
    return q.docs.map(fromDoc);
  }

  function watch(sid, col, where, cb, err) {
    if (!cloud) return lwatch(() => cb(Object.entries(Lcol(sid, col)).map(([id, o]) => ({ id, ...o })).filter((o) => match(o, where))));
    let q = S(sid).collection(col);
    (where || []).forEach(([f, op, v]) => { q = q.where(f, op, v); });
    return q.onSnapshot((snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), err || (() => {}));
  }
  async function add(sid, col, obj) {
    if (!cloud) { const id = rid(); Lcol(sid, col)[id] = obj; commit(); return id; }
    const ref = S(sid).collection(col).doc();
    ref.set(obj).catch(() => {});   // sans attendre : hors connexion, l'écriture part plus tard
    return ref.id;
  }
  async function set(sid, col, id, obj) {
    if (!cloud) { Lcol(sid, col)[id] = obj; commit(); return; }
    return S(sid).collection(col).doc(id).set(obj);
  }
  async function update(sid, col, id, patch) {
    if (!cloud) { Object.assign(Lcol(sid, col)[id] || {}, patch); commit(); return; }
    S(sid).collection(col).doc(id).update(patch).catch(() => {});
  }
  async function remove(sid, col, id) {
    if (!cloud) { delete Lcol(sid, col)[id]; commit(); return; }
    S(sid).collection(col).doc(id).delete().catch(() => {});
  }
  async function getDoc(sid, col, id) {
    if (!cloud) { const o = Lcol(sid, col)[id]; return o ? { id, ...o } : null; }
    const d = await S(sid).collection(col).doc(id).get(); return d.exists ? { id, ...d.data() } : null;
  }

  // Numéro de ticket du jour, sans doublon même si deux clients le prennent en même temps
  async function nextNumber(sid, day) {
    if (!cloud) { const m = Lcol(sid, "meta"); const c = m.counter && m.counter.day === day ? m.counter.n + 1 : 1; m.counter = { day, n: c }; commit(); return c; }
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
    if (!cloud) { if (codeIn !== (await staffCode(sid))) throw new Error("code"); return set(sid, "staff", uid, { coiffeurId, code: codeIn }); }
    await S(sid).collection("staff").doc(uid).set({ coiffeurId, code: codeIn });
  }

  async function declarePayment(rec) {
    if (!cloud) return;
    await db.collection("paiements").add({ ...rec, uid: user.uid, at: FV.serverTimestamp(), status: "attente" });
  }
  function watchPayments(cb) {
    if (!cloud) { cb([]); return () => {}; }
    return db.collection("paiements").where("status", "==", "attente").onSnapshot((s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => cb([]));
  }
  async function validatePayment(p, until) {
    const b = db.batch();
    b.update(S(p.sid), { premiumUntil: until });
    b.update(db.collection("paiements").doc(p.id), { status: "valide" });
    await b.commit();
  }

  return {
    cloud, init, ensureUser, signIn, signInEmail, signOut, isAccount,
    get uid() { return cloud ? (user ? user.uid : null) : LOCAL_UID; },
    get email() { return user ? user.email || "" : ""; },
    createSalon, watchSalon, getSalon, updateSalon, mySalons,
    watch, add, set, update, remove, getDoc, nextNumber,
    staffCode, newStaffCode, joinStaff, declarePayment, watchPayments, validatePayment,
    // démo : remplit un salon d'exemple
    _seed(sid, all) { if (cloud) return; load(); mem[sid] = all; commit(); },
  };
})();
