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
  fs.writeFileSync(__dirname + '/regles-test.rules', fs.readFileSync(__dirname + '/../firestore.rules', 'utf8').replace("['UID_ADMIN']", `['${ADMIN.uid}']`));
  await new Promise((ok) => setTimeout(ok, 5000));   // l'émulateur recharge les règles
  const b = await chromium.launch();
  const errs = [];
  const phone = async (name) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { window.SALON_EMU = true; });
    await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ body: fs.readFileSync(NM + r.request().url().split('/').pop(), 'utf8'), contentType: 'text/javascript' }));
    await ctx.route('**/sw.js', (r) => r.fulfill({ status: 404, body: '' }));
    await ctx.route('**/config.js', async (r) => r.fulfill({ body: fs.readFileSync(__dirname + '/../docs/config.js', 'utf8').replace('admins: []', `admins: ["${ADMIN.uid}"]`), contentType: 'text/javascript' }));
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { if (!/Erreur de test/.test(e.message)) errs.push(name + ': ' + e.message); });
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts|404/.test(m.text())) errs.push(name + ' console: ' + m.text()); });
    return p;
  };
  const txt = async (p, sel) => (await p.textContent(sel)).replace(/\s+/g, ' ');
  const W = (p, ms = 1500) => p.waitForTimeout(ms);

  // 1. Le patron crée son compte et son salon
  const pat = await phone('patron'); await pat.goto(U + '#demarrer'); await W(pat, 2500);
  await pat.fill('#em-mail', `patron${Date.now()}@test.sn`); await pat.fill('#em-pass', 'secret123'); await pat.click('#em [data-a="new"]'); await W(pat, 3000);
  await pat.fill('#n-name', 'Salon Essai'); await pat.fill('#n-q', 'Médina'); await pat.fill('#n-tel', '771112233'); await pat.fill('#n-coif', 'Modou, Ibou');
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
  await pat.goto(U + '#salon'); await W(pat, 3000);
  const code = (await pat.textContent('#sc')).trim();
  const coi = await phone('coiffeur'); await coi.goto(U + '#rejoindre'); await W(coi, 2500);
  await coi.fill('#j-sid', sid); await coi.fill('#j-code', code); await coi.click('#j .btn'); await W(coi, 3000);
  await coi.click('#j-who [data-c]:nth-child(2)'); await W(coi, 3000);
  await coi.goto(U + '#caisse'); await W(coi, 3000);
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
  check((await txt(adm, '#ad-kpi')).includes('salons inscrits'), 'admin : chiffres globaux affichés');
  check((await txt(adm, `[data-sid="${sid}"]`)).includes('Actif'), 'admin : salon actif cette semaine');
  check((await txt(adm, '#ad-err')).includes('Erreur de test e2e'), 'admin : erreur d\'un téléphone remontée');
  const peek = await cli.evaluate(async () => { try { await firebase.firestore().collection('erreurs').get(); return 'accepté'; } catch (e) { return e.code; } });
  check(peek === 'permission-denied', 'règles : un client ne lit pas les erreurs (' + peek + ')');
  await adm.click(`[data-sid="${sid}"] [data-ad="block"]`); await W(adm, 2500);
  check((await txt(adm, `[data-sid="${sid}"]`)).includes('Suspendu'), 'admin : salon suspendu');
  const cli2 = await phone('client2'); await cli2.goto(U + '#ticket/' + sid); await W(cli2, 3000);
  check((await txt(cli2, '#t-body')).includes("pas disponible"), 'client : salon suspendu, pas de ticket possible');
  const forced = await cli2.evaluate(async (sid) => { try { const u = (await firebase.auth().signInAnonymously()).user; await firebase.firestore().collection('salons').doc(sid).collection('queue').add({ day: '2030-01-01', num: 1, name: 'X', status: 'attente', uid: u.uid }); return 'accepté'; } catch (e) { return e.code; } }, sid);
  check(forced === 'permission-denied', 'règles : ticket refusé sur un salon suspendu (' + forced + ')');
  await adm.click(`[data-sid="${sid}"] [data-ad="unblock"]`); await W(adm, 2000);
  const notAdmin = await phone('pas-admin'); await notAdmin.goto(U + '#admin'); await W(notAdmin, 2500);
  check((await txt(notAdmin, 'main')).includes('Connecte-toi'), 'espace admin fermé sans compte');

  console.log(errs.length ? 'Erreurs :\n' + errs.join('\n') : 'Aucune erreur de page');
  console.log(fails ? `${fails} ÉCHEC(S)` : 'TOUT EST BON');
  await b.close(); process.exit(fails ? 1 : 0);
})();
