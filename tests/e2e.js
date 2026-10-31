// Parcours complet contre les émulateurs Firebase (Auth + Firestore avec les vraies règles)
const { chromium } = require('playwright');
const fs = require('fs');
const NM = __dirname + '/node_modules/firebase/';
const U = 'http://localhost:8765/';
let fails = 0; const check = (ok, label) => { console.log((ok ? 'OK   ' : 'ÉCHEC ') + label); if (!ok) fails++; };
(async () => {
  // compte admin créé d'avance dans l'émulateur, puis ajouté aux règles et à l'appli
  const su = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `admin${Date.now()}@test.sn`, password: 'admin123', returnSecureToken: true }) })).json();
  const ADMIN = { uid: su.localId, email: su.email };
  fs.writeFileSync(__dirname + '/regles-test.rules', fs.readFileSync(__dirname + '/../firestore.rules', 'utf8').replace(/function admin\(\) \{[^}]*\}/, `function admin() { return signed() && request.auth.uid in ['${ADMIN.uid}']; }`));
  await new Promise((ok) => setTimeout(ok, 5000));   // l'émulateur recharge les règles
  const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
  const errs = [];
  const phone = async (name) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { window.SALON_EMU = true; });
    await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ body: fs.readFileSync(NM + r.request().url().split('/').pop(), 'utf8'), contentType: 'text/javascript' }));
    await ctx.route('**/sw.js', (r) => r.fulfill({ status: 404, body: '' }));
    await ctx.route('**/config.js', async (r) => r.fulfill({ body: fs.readFileSync(__dirname + '/../docs/config.js', 'utf8').replace(/admins: \[[^\]]*\]/, `admins: ["${ADMIN.uid}"]`), contentType: 'text/javascript' }));
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { if (!/Erreur de test/.test(e.message)) errs.push(name + ': ' + e.message); });
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts|404/.test(m.text())) errs.push(name + ' console: ' + m.text()); });
    return p;
  };
  const txt = async (p, sel) => (await p.textContent(sel)).replace(/\s+/g, ' ');
  const W = (p, ms = 1500) => p.waitForTimeout(ms);

  // 1. Le patron crée son compte et son salon
  const pat = await phone('patron'); await pat.goto(U + '#demarrer'); await W(pat, 2500);
  // connexion par numéro et code à 4 chiffres : le compte se crée la première fois
  const PAT = '77' + String(Date.now()).slice(-7), NPT = '33' + String(Date.now() + 7).slice(-7);
  await pat.fill('#ph-tel', '12 34'); await pat.fill('#ph-pin', '135799'); await pat.click('#ph [data-p="in"]'); await W(pat, 300);
  check((await txt(pat, '#ph-msg')).includes('Numéro invalide') && await pat.inputValue('#ph-tel') === '12 34', 'connexion : numéro invalide refusé, saisie gardée');
  await pat.fill('#ph-nom', 'Modou Fall'); await pat.fill('#ph-tel', '+221 ' + PAT.replace(/(\d{2})(\d{3})/, '$1 $2 ')); await pat.click('#ph [data-p="new"]'); await W(pat, 3000);
  check(await pat.inputValue('#n-tel') === PAT, 'patron : compte créé avec son numéro, numéro du salon prérempli');
  await pat.fill('#n-name', 'Salon Essai'); await pat.fill('#n-q', 'Médina'); await pat.fill('#n-coif', 'Modou, Ibou');
  await pat.click('#new .btn'); await W(pat, 3000);
  const sid = (await pat.evaluate(() => JSON.parse(localStorage.getItem('salon-me')))).sid;
  check(/^[A-Z0-9]{5}$/.test(sid || ''), 'salon créé, code ' + sid);

  // 2. Un client (autre téléphone) réserve dimanche à 11h00
  const cli = await phone('client'); await cli.goto(U + '#reserver/' + sid); await W(cli, 3000);
  const sunday = await cli.evaluate(() => { for (let i = 1; i < 8; i++) { const d = new Date(Date.now() + i * 864e5); if (d.getDay() === 0) return dayOf(d.getTime()); } });
  await cli.click(`#rv-day [data-v="${sunday}"]`); await W(cli, 500);
  await cli.click('#rv-time [data-v="11:00"]'); await W(cli, 300);
  await cli.fill('#rv-name', 'Fallou'); await cli.fill('#rv-tel', '770000001'); await cli.click('#rv-f .btn.big'); await W(cli, 3000);
  check((await txt(cli, '#rv')).includes('Mes rendez-vous'), 'client : rendez-vous affiché dans « Mes rendez-vous »');

  // 3. Le patron voit le rendez-vous
  await pat.goto(U + '#rdv'); await W(pat, 3000);
  const rl = await txt(pat, '#r-list');
  check(rl.includes('Fallou') && rl.includes('11:00'), 'patron : voit le rendez-vous de Fallou à 11:00');

  // 4. Le créneau n'est plus proposé deux fois pour le même coiffeur… et le report marche
  await cli.click('[data-mv="report"]'); await W(cli, 500); await cli.click('#rv-time [data-v="15:00"]'); await W(cli, 300); await cli.click('#rv-f .btn.big'); await W(cli, 3000);
  await W(pat, 1500); check((await txt(pat, '#r-list')).includes('15:00'), 'report du rendez-vous à 15:00 vu par le patron');

  // 5. File : le client prend un ticket, le patron l'appelle, le client le voit
  await cli.goto(U + '#ticket/' + sid); await W(cli, 2500);
  await cli.fill('#t-name', 'Fallou'); await cli.fill('#t-tel', '770000001'); await cli.click('#t-form .btn.big'); await W(cli, 3000);
  check(/Ton numéro\s*1/.test(await txt(cli, '#t-body')), 'client : ticket n° 1');
  await pat.goto(U + '#file'); await W(pat, 2500);
  check((await txt(pat, '#f-wait')).includes('Fallou'), 'patron : Fallou dans la file');
  await pat.click('#f-wait [data-a="appel"]'); await W(cli, 2500);
  check((await txt(cli, '#t-body')).includes("C'est ton tour"), 'client : « C\'est ton tour ! » après l\'appel');
  await pat.click('#f-wait [data-a="chair"]'); await W(pat, 500); if (await pat.$('.sheet')) await pat.click('.sheet [data-i="0"]'); await W(pat, 1500);
  await pat.click('#f-chair [data-a="fini"]'); await W(pat, 500); await pat.click('.sheet [data-i="1"]'); await W(pat, 2500);

  // 6. Caisse et fiche client
  await pat.goto(U + '#caisse'); await W(pat, 2500);
  check((await txt(pat, '#c-tot')).includes('1 500 F'), 'caisse : 1 500 F encaissés (Wave)');
  await pat.goto(U + '#clients'); await W(pat, 2500);
  check((await txt(pat, '#cl-list')).includes('Fallou'), 'fiche client de Fallou créée');

  // 7. Un coiffeur rejoint le salon et ne voit que ses coupes
  // le patron montre le QR code, le coiffeur le scanne : les codes sont déjà remplis
  await pat.goto(U + '#file'); await W(pat, 2500);
  check((await txt(pat, '#f-guide')).includes('Pour bien démarrer · 0/3'), 'patron : guide du premier démarrage affiché');
  await pat.click('#f-guide [data-g="coif"]'); await W(pat, 3000);
  check(pat.url().endsWith('#salon/d-coif') && await pat.evaluate(() => document.getElementById('d-coif').open), 'guide : ouvre la rubrique Coiffeurs');
  check(await pat.isVisible('#s-code svg'), 'patron : QR code pour relier un coiffeur');
  const code = (await pat.textContent('#sc')).trim();
  const coi = await phone('coiffeur'); await coi.goto(U); await W(coi, 2500);
  await coi.fill('#cli-code', code); await coi.click('#cli .btn'); await W(coi, 3500);
  check(code.length === 10 && await coi.isVisible('#j-who [data-c]'), 'coiffeur : un seul code sur l\'accueil, il n\'a plus qu\'à toucher son prénom');
  await coi.click('#j-who [data-c]:nth-child(2)'); await W(coi, 3000);
  await coi.goto(U + '#caisse'); await W(coi, 3000);
  await pat.goto(U + '#file'); await W(pat, 2500);
  check((await txt(pat, '#f-guide')).includes('1/3'), 'guide : étape cochée (1/3)');
  await pat.click('#f-guide [data-g="off"]'); await W(pat, 2000);
  check((await txt(pat, '#f-guide')) === '', 'guide : masqué');
  check((await txt(coi, 'main')).includes('Mes coupes'), 'coiffeur : page « Mes coupes » ouverte');
  await coi.click('#c-svc [data-s]'); await W(coi, 2500);
  check((await txt(coi, '#c-tot')).includes('1 500 F'), 'coiffeur : sa coupe encaissée');
  await coi.goto(U + '#bilan'); await W(coi, 1000);
  check(!(await txt(coi, 'main')).includes('Bilan de'), 'coiffeur : pas d\'accès au bilan');

  // 8. Annuaire et page du salon
  await pat.goto(U + '#salon'); await W(pat, 2000); await pat.click('text=Informations et horaires'); await pat.check('#o-ann'); await W(pat, 1500);
  await cli.goto(U + '#annuaire'); await W(cli, 3000);
  check((await txt(cli, '#an-list')).includes('Salon Essai'), 'annuaire : le salon apparaît');

  // 9. Espace admin : un patron ne peut pas lever une suspension, l'admin voit le salon, son activité, les erreurs, et le suspend
  const self = await pat.evaluate(async (sid) => { try { await firebase.firestore().collection('salons').doc(sid).update({ blocked: false }); return 'accepté'; } catch (e) { return e.code; } }, sid);
  check(self === 'permission-denied', 'patron : ne peut pas toucher à la suspension (' + self + ')');
  await cli.evaluate(() => setTimeout(() => { throw new Error('Erreur de test e2e'); }));
  await W(cli, 2500);
  const adm = await phone('admin'); await adm.goto(U + '#admin'); await W(adm, 2500);
  await adm.fill('#ad-mail', ADMIN.email); await adm.fill('#ad-pass', 'admin123'); await adm.click('#ad-em .btn'); await W(adm, 4000);
  check((await txt(adm, '#ad-list')).includes('Salon Essai'), 'admin : voit le salon dans la liste');
  check((await txt(adm, '#ad-kpi')).includes('inscrit'), 'admin : chiffres globaux affichés');
  check((await txt(adm, `[data-sid="${sid}"]`)).includes('Actif'), 'admin : salon actif cette semaine');
  await adm.click('[data-tab="erreurs"]'); check((await txt(adm, '#ad-err')).includes('Erreur de test e2e'), 'admin : erreur d\'un téléphone remontée');
  await adm.click('[data-tab="comptes"]');
  const peek = await cli.evaluate(async () => { try { await firebase.firestore().collection('erreurs').get(); return 'accepté'; } catch (e) { return e.code; } });
  check(peek === 'permission-denied', 'règles : un client ne lit pas les erreurs (' + peek + ')');
  await adm.click(`[data-sid="${sid}"] [data-ad="block"]`); await W(adm, 2500);
  check((await txt(adm, `[data-sid="${sid}"]`)).includes('Suspendu'), 'admin : salon suspendu');
  const cli2 = await phone('client2'); await cli2.goto(U + '#ticket/' + sid); await W(cli2, 3000);
  check((await txt(cli2, '#t-body')).includes("pas disponible"), 'client : salon suspendu, pas de ticket possible');
  const forced = await cli2.evaluate(async (sid) => { try { const u = (await firebase.auth().signInAnonymously()).user; await firebase.firestore().collection('salons').doc(sid).collection('queue').add({ day: '2030-01-01', num: 1, name: 'X', status: 'attente', uid: u.uid }); return 'accepté'; } catch (e) { return e.code; } }, sid);
  check(forced === 'permission-denied', 'règles : ticket refusé sur un salon suspendu (' + forced + ')');
  await adm.click(`[data-sid="${sid}"] [data-ad="unblock"]`); await W(adm, 2000);
  // 10. Mode présentation : salon de démo, puis patron, coiffeur et client sur le même téléphone
  await adm.goto(U + '#admin'); await W(adm, 2500);
  await adm.click('[data-tog="ad-p-demo"]'); await W(adm, 1000); await adm.click('#ad-new-demo'); await W(adm, 5000);
  check((await txt(adm, 'main')).includes('Fallou') && (await txt(adm, '#demo-bar')).includes('Présentation'), 'présentation : salon démo créé, file remplie, barre affichée');
  await adm.click('[data-dr="coiffeur"]'); await W(adm, 2500);
  check((await txt(adm, '#tabs')).includes('Mes coupes'), 'présentation : vue coiffeur');
  await adm.click('[data-dr="client"]'); await W(adm, 2500);
  check(adm.url().includes('#ticket/') && (await txt(adm, '#t-body')).includes('Salon Démo'), 'présentation : vue client');
  await adm.screenshot({ path: __dirname + '/../../presentation.png' });
  await adm.click('[data-dr="patron"]'); await W(adm, 2500);
  check((await txt(adm, '#tabs')).includes('Bilan'), 'présentation : retour patron');
  await adm.click('[data-dr="fin"]'); await W(adm, 2500);
  check(adm.url().endsWith('#admin') && await adm.isHidden('#demo-bar') && (await txt(adm, '#ad-list')).includes('Démo'), 'présentation : fin, retour à l\'admin');
  // 11. L'admin ouvre le salon d'un client en vue patron : il voit tout, mais ne peut rien modifier
  await adm.click(`[data-sid="${sid}"] [data-demo]`); await W(adm, 3000);
  check((await txt(adm, '#demo-bar')).includes('Vue de Salon Essai'), 'admin : vue patron du salon d\'un client');
  await adm.goto(U + '#bilan'); await W(adm, 3000);
  check((await txt(adm, 'main')).includes('1 500'), 'admin : voit le bilan réel du salon (1 500 F)');
  const w = await adm.evaluate(async (sid) => { try { await firebase.firestore().collection('salons').doc(sid).update({ name: 'Piraté' }); return 'accepté'; } catch (e) { return e.code; } }, sid);
  check(w === 'permission-denied', 'règles : l\'admin ne modifie pas le salon d\'un client (' + w + ')');
  await adm.click('[data-dr="fin"]'); await W(adm, 2000);
  // 12. Le propriétaire connecté arrive tout seul sur l'espace admin, et le bouton admin reste en haut
  await adm.goto(U + '#accueil'); await W(adm, 2500);
  check(adm.url().endsWith('#admin'), 'propriétaire : l\'accueil ouvre l\'espace admin');
  await adm.click('#ad-list [data-demo]'); await W(adm, 2500);
  check(await adm.isVisible('#adm-link'), 'propriétaire : bouton « Espace admin » en haut en vue patron');
  await adm.click('#adm-link'); await W(adm, 2000);
  check(adm.url().endsWith('#admin'), 'propriétaire : retour à l\'admin en un appui');
  const neuf = await phone('nouveau'); await neuf.goto(U + '#accueil'); await W(neuf, 2500);
  check(await neuf.isHidden('#adm-link') && (await txt(neuf, 'main')).includes('Espace propriétaire'), 'client : pas de bouton admin, lien discret en bas de l\'accueil');
  // 13. L'admin invite un nouveau patron : lien et QR code, salon prérempli chez le patron
  await adm.goto(U + '#admin'); await W(adm, 2500);
  await adm.click('[data-tog="ad-p-inv"]'); await adm.click('#iv-quick'); await W(adm, 300); check(await adm.isVisible('.qr-full svg'), 'admin : QR plein écran pour un nouveau patron'); await adm.click('.qr-full'); await adm.fill('#iv-n', 'Salon Invité'); await adm.fill('#iv-q', 'Pikine'); await adm.fill('#iv-t', NPT); await adm.fill('#iv-c', 'Abdou, Lamine');
  await adm.click('#ad-inv .btn'); await W(adm, 1000);
  if (process.env.SHOTS) { await adm.evaluate(() => scrollTo(0, 0)); await adm.screenshot({ path: process.env.SHOTS + '/admin.png', fullPage: true }); }
  const link = await adm.evaluate(() => document.querySelector('#iv-out a[href*="wa.me"]').href);
  const inviteUrl = decodeURIComponent(link.split('text=')[1]).match(/http\S+/)[0];
  check(await adm.isVisible('#iv-out svg') && inviteUrl.includes('#invite/'), 'admin : lien et QR code d\'invitation créés');
  const np = await phone('nouveau-patron'); await np.goto(inviteUrl); await W(np, 2500);
  check((await txt(np, 'main')).includes('Installe l\'appli'), 'nouveau patron : invitation à installer l\'appli dès l\'ouverture du lien');
  if (process.env.SHOTS) await np.screenshot({ path: process.env.SHOTS + '/invite.png' });
  check(await np.inputValue('#ph-tel') === NPT, 'nouveau patron : son numéro est déjà rempli');
  await np.fill('#ph-nom', 'Abdou Ndiaye'); await np.fill('#ph-pin', '246802'); await np.click('#ph [data-p="new"]'); await W(np, 3000);
  check(await np.inputValue('#n-name') === 'Salon Invité' && await np.inputValue('#n-coif') === 'Abdou, Lamine', 'nouveau patron : salon prérempli après l\'inscription');
  await np.click('#new .btn'); await W(np, 3000);
  await adm.goto(U + '#admin'); await W(adm, 3000);
  check((await txt(adm, '#ad-list')).includes('Salon Invité'), 'admin : le salon invité apparaît dans la liste');
  // 14. Le patron se reconnecte sur un autre téléphone : « Se connecter » l'emmène directement dans son salon
  const pat2 = await phone('patron-2'); await pat2.goto(U); await W(pat2, 2500);
  await pat2.click('a[href="#demarrer/auto"]'); await W(pat2, 2000);
  await pat2.fill('#ph-tel', PAT); await pat2.fill('#ph-pin', '999999'); await pat2.click('#ph [data-p="in"]'); await W(pat2, 3000);
  check((await txt(pat2, '#ph-msg')).includes('Numéro ou code incorrect'), 'patron : mauvais code refusé');
  await pat2.fill('#ph-nom', 'X Y'); await pat2.click('#ph [data-p="new"]'); await W(pat2, 2500);
  check((await txt(pat2, '#ph-msg')).includes('existe déjà'), 'patron : compte existant signalé');
  await pat2.fill('#ph-pin', '135799'); await pat2.click('#ph [data-p="in"]'); await W(pat2, 4000);
  check(pat2.url().endsWith('#file') && (await txt(pat2, '#tabs')).includes('Bilan'), 'patron : « Se connecter » ouvre directement son salon');
  await coi.goto(U + '#file'); await W(coi, 2500); await coi.click('#f-qr'); await W(coi, 500);
  check(await coi.isVisible('.qr-full svg'), 'coiffeur : QR client affiché en grand');
  await coi.click('.qr-full'); await W(coi, 300);
  check(!(await coi.isVisible('.qr-full')), 'coiffeur : QR client refermé');
  const cl3 = await phone('client-3'); await cl3.goto(U); await W(cl3, 2500);
  await cl3.fill('#cli-code', sid.toLowerCase()); await cl3.click('#cli .btn'); await W(cl3, 3000);
  check(cl3.url().includes('#ticket/' + sid), 'client : le code du salon ouvre la page du ticket');
  // 15. Base des numéros, invitations suivies, paiement noté à la main, messages, suspension programmée
  await adm.goto(U + '#admin'); await W(adm, 3500);
  await adm.click('[data-tab="base"]'); await W(adm, 800);
  const bt = await txt(adm, '#ad-base');
  check(bt.includes('Fallou') && bt.includes('770000001') && bt.includes(PAT), 'admin : numéros du client et du patron dans la base');
  const peekBase = await cli.evaluate(async () => { try { await firebase.firestore().collection('base').get(); return 'accepté'; } catch (e) { return e.code; } });
  check(peekBase === 'permission-denied', 'règles : un client ne lit pas la base des numéros (' + peekBase + ')');
  await adm.click('[data-tab="invit"]'); await W(adm, 800);
  check((await txt(adm, '#ad-t-invit')).includes('Salon créé'), 'admin : invitation suivie jusqu\'au salon créé');
  await adm.click('[data-tab="comptes"]'); await W(adm, 500);
  await adm.click(`[data-sid="${sid}"] [data-ad="detail"]`); await W(adm, 3000);
  check((await txt(adm, `[data-sid="${sid}"] .ad-detail`)).includes('Fonctions utilisées'), 'admin : détail du salon (courbe et fonctions)');
  check((await txt(adm, `[data-sid="${sid}"]`)).includes('Essai jusqu'), 'admin : fin de l\'essai affichée');
  await adm.click(`[data-sid="${sid}"] [data-ad="pay"]`); await W(adm, 2500);
  check((await txt(adm, `[data-sid="${sid}"]`)).includes('Dernier paiement : 2 000 F') && (await txt(adm, '#ad-kpi')).includes('encaissé par toi'), 'admin : paiement de 2 000 F noté, total du mois');
  await adm.fill(`[data-sid="${sid}"] [data-pf="msg"]`, 'Bonjour patron, tout va bien ?'); await adm.click(`[data-sid="${sid}"] [data-ad="send"]`); await W(adm, 2500);
  await pat.goto(U + '#salon'); await W(pat, 3000);
  check((await txt(pat, '#s-msg')).includes('message'), 'patron : message de l\'équipe signalé');
  await pat.goto(U + '#aide'); await W(pat, 2000);
  check((await txt(pat, '#ai-list')).includes('tout va bien'), 'patron : lit le message de l\'équipe');
  await pat.fill('#ai-t', 'La caisse ne marche pas'); await pat.click('#ai-f .btn'); await W(pat, 2500);
  await adm.click('[data-tab="messages"]'); await W(adm, 1500);
  check((await txt(adm, '#ad-t-messages')).includes('La caisse ne marche pas'), 'admin : reçoit « J\'ai un problème » du patron');
  await adm.click('[data-tab="journal"]'); await W(adm, 800);
  check((await txt(adm, '#ad-t-journal')).includes('Paiement de 2 000 F'), 'admin : journal des actions');
  await adm.click('[data-tab="tel"]'); await W(adm, 800);
  check((await txt(adm, '#ad-t-tel')).includes('version'), 'admin : téléphones avec version et temps de chargement');
  // suspension programmée hier sur le salon invité : plus de ticket possible
  const sid2 = (await np.evaluate(() => JSON.parse(localStorage.getItem('salon-me')))).sid;
  await adm.click('[data-tab="comptes"]'); await W(adm, 500);
  await adm.click(`[data-sid="${sid2}"] [data-ad="detail"]`); await W(adm, 1500);
  await adm.fill(`[data-sid="${sid2}"] [data-pf="blockAt"]`, await adm.evaluate(() => dayOf(Date.now() - 864e5))); await adm.click(`[data-sid="${sid2}"] [data-ad="blockAt"]`); await W(adm, 2500);
  const forced2 = await cli2.evaluate(async (sid) => { try { const u = (await firebase.auth().signInAnonymously()).user; await firebase.firestore().collection('salons').doc(sid).collection('queue').add({ day: '2030-01-01', num: 1, name: 'X', status: 'attente', uid: u.uid }); return 'accepté'; } catch (e) { return e.code; } }, sid2);
  check(forced2 === 'permission-denied', 'règles : suspension programmée appliquée (' + forced2 + ')');
  // transfert du salon invité à un nouveau patron
  await adm.click(`[data-sid="${sid2}"] [data-ad="transfer"]`); await W(adm, 2500);
  const tlink = decodeURIComponent((await adm.evaluate((s) => document.querySelector(`[data-sid="${s}"] .ad-out a[href*="wa.me"]`).href, sid2)).split('text=')[1]).match(/http\S+/)[0];
  const rp = await phone('repreneur'); await rp.goto(tlink); await W(rp, 2500);
  await rp.fill('#ph-nom', 'Ousmane Repreneur'); await rp.fill('#ph-tel', '76' + String(Date.now()).slice(-7)); await rp.fill('#ph-pin', '424242'); await rp.click('#ph [data-p="new"]'); await W(rp, 4000);
  const own = await rp.evaluate(async (sid) => (await firebase.firestore().collection('salons').doc(sid).get()).data().owner === firebase.auth().currentUser.uid, sid2);
  check(own && rp.url().includes('#salon'), 'transfert : le nouveau patron reprend le salon');
  const again = await np.evaluate(async (sid) => { try { await firebase.firestore().collection('salons').doc(sid).update({ name: 'Volé' }); return 'accepté'; } catch (e) { return e.code; } }, sid2);
  check(again === 'permission-denied', 'transfert : l\'ancien patron n\'a plus la main (' + again + ')');
  // associé en lecture seule
  const as = await phone('associe'); await as.goto(U + '#demarrer'); await W(as, 2500);
  await as.fill('#ph-nom', 'Awa Associée'); await as.fill('#ph-tel', '70' + String(Date.now()).slice(-7)); await as.fill('#ph-pin', '515151'); await as.click('#ph [data-p="new"]'); await W(as, 3000);
  const asUid = await as.evaluate(() => firebase.auth().currentUser.uid);
  await adm.click('[data-tog="ad-p-as"]'); await W(adm, 500); await adm.fill('#as-uid', asUid); await adm.click('#as-add'); await W(adm, 2500);
  await as.goto(U + '#admin'); await W(as, 4000);
  check((await txt(as, '#ad-list')).includes('Salon Essai') && !(await as.isVisible('[data-ad="block"]')), 'associé : voit les salons, sans bouton Suspendre');
  const asBlock = await as.evaluate(async (sid) => { try { await firebase.firestore().collection('salons').doc(sid).update({ blocked: true }); return 'accepté'; } catch (e) { return e.code; } }, sid);
  check(asBlock === 'permission-denied', 'règles : l\'associé ne suspend pas (' + asBlock + ')');

  // 16. Patron : crédit, liste noire, pause, fermeture, gérant, objectif, verrou, retrait d'un coiffeur
  await cli.goto(U + '#ticket/' + sid); await W(cli, 2500);
  await cli.fill('#t-name', 'Fallou'); await cli.fill('#t-tel', '770000001'); await cli.click('#t-form .btn.big'); await W(cli, 3000);
  await pat.goto(U + '#file'); await W(pat, 3000);
  await pat.click('#f-wait [data-a="chair"]'); await W(pat, 800);
  if (await pat.isVisible('.sheet')) { await pat.click('.sheet [data-i="0"]'); await W(pat, 1500); }
  await pat.click('#f-chair [data-a="fini"]'); await W(pat, 800);
  await pat.click('.sheet button:has-text("crédit")'); await W(pat, 2500);
  await pat.goto(U + '#clients'); await W(pat, 3000);
  check((await txt(pat, '#cl-credit')).includes('Crédits en cours') && (await txt(pat, '#cl-credit')).includes('Fallou'), 'patron : coupe à crédit suivie dans Clients');
  await pat.click('#cl-credit [data-crp]'); await W(pat, 800); await pat.click('.sheet [data-i="0"]'); await W(pat, 2500);
  check(!(await txt(pat, '#cl-credit')).includes('Fallou'), 'patron : crédit payé, sorti de la liste');
  await pat.click('#cl-list [data-noir]'); await W(pat, 800); await pat.click('.sheet [data-i="1"]'); await W(pat, 2000);
  check((await txt(pat, '#cl-list')).includes('Liste noire'), 'patron : client sur la liste noire');
  await cli.goto(U + '#ticket/' + sid); await W(cli, 2500);
  await cli.fill('#t-name', 'Fallou'); await cli.fill('#t-tel', '770000001'); await cli.click('#t-form .btn.big'); await W(cli, 3000);
  await pat.goto(U + '#file'); await W(pat, 3000);
  check((await txt(pat, '#f-wait')).includes('Ne paie pas'), 'file : client de la liste noire signalé');
  await pat.goto(U + '#salon'); await W(pat, 2500); await pat.click('text=Coiffeurs et pointage'); await W(pat, 500);
  await pat.click('#s-pt [data-in]'); await W(pat, 1500);
  await pat.goto(U + '#file'); await W(pat, 2500);
  await pat.click('[data-pause]'); await W(pat, 2000);
  check((await txt(pat, '.pause-bar')).includes('en pause'), 'patron : pause de 15 min notée');
  await pat.click('[data-pause]'); await W(pat, 1500);
  // gérant : Ibou (le coiffeur relié) devient gérant
  await pat.goto(U + '#salon'); await W(pat, 2500); await pat.click('text=Coiffeurs et pointage'); await W(pat, 500);
  await pat.check('#s-coif [data-co]:nth-child(2) [data-f="gerant"]'); await W(pat, 3000);
  await coi.goto(U + '#file'); await W(coi, 4000);
  check((await txt(coi, '#tabs')).includes('Clients'), 'gérant : onglet Clients');
  await coi.goto(U + '#caisse'); await W(coi, 3000);
  check((await txt(coi, 'main')).includes('Caisse du jour'), 'gérant : caisse de tout le salon');
  // fermeture exceptionnelle aujourd'hui
  await pat.click('text=Fermetures et Ramadan'); await W(pat, 500);
  await pat.click('#fx-m [data-v="Magal"]'); await pat.fill('#fx-du', await pat.evaluate(() => dayOf())); await pat.click('#fx-f .btn'); await W(pat, 2500);
  await cli2.goto(U + '#ticket/' + sid); await W(cli2, 3000);
  check((await txt(cli2, '#t-body')).includes('Salon fermé (Magal)'), 'client : fermeture exceptionnelle affichée');
  await pat.click('#fx-x'); await W(pat, 1500);
  // objectif et comparaison dans le bilan
  await pat.goto(U + '#bilan'); await W(pat, 3000);
  await pat.fill('#bp-goal-i', '100000'); await pat.click('#bp-goal-b'); await W(pat, 2500);
  check((await txt(pat, '#b-plus')).includes('Objectif du mois') && (await txt(pat, '#bp-cmp')).includes('Évolution'), 'bilan : objectif et comparaison');
  // verrou de la caisse
  await pat.goto(U + '#salon'); await W(pat, 2500); await pat.click('text=Ce téléphone'); await pat.fill('#ph-pin', '1234'); await pat.click('#ph-pin-b'); await W(pat, 500);
  await pat.evaluate(() => { ME.pinOk = 0; saveMe(); }); await pat.goto(U + '#bilan'); await W(pat, 1500);
  check((await txt(pat, 'main')).includes('Caisse verrouillée'), 'verrou : bilan caché sans le code');
  await pat.fill('#pin-v', '1234'); await pat.click('#pin-f .btn'); await W(pat, 2000);
  check((await txt(pat, 'main')).includes('Bilan de'), 'verrou : le code ouvre le bilan');
  // retrait d'un coiffeur : son téléphone perd l'accès
  await pat.goto(U + '#salon'); await W(pat, 2500); await pat.click('text=Coiffeurs et pointage'); await W(pat, 500);
  await pat.click('#s-coif [data-co]:nth-child(2) [data-rm="coif"]'); await W(pat, 800); await pat.click('.sheet [data-i="0"]'); await W(pat, 3000);
  const gone = await coi.evaluate(async (sid) => { try { await firebase.firestore().collection('salons').doc(sid).collection('clients').get(); return 'accepté'; } catch (e) { return e.code; } }, sid);
  check(gone === 'permission-denied', 'coiffeur retiré : son téléphone n\'a plus accès (' + gone + ')');

  const notAdmin = await phone('pas-admin'); await notAdmin.goto(U + '#admin'); await W(notAdmin, 2500);
  check((await txt(notAdmin, 'main')).includes('Connecte-toi'), 'espace admin fermé sans compte');

  console.log(errs.length ? 'Erreurs :\n' + errs.join('\n') : 'Aucune erreur de page');
  console.log(fails ? `${fails} ÉCHEC(S)` : 'TOUT EST BON');
  await b.close(); process.exit(fails ? 1 : 0);
})();
