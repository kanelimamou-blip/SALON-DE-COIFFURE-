# Salon

Appli de téléphone pour les salons de coiffure hommes au Sénégal : file d'attente en direct, ticket pris à distance, catalogue des coupes et caisse du salon. Elle s'installe sur l'écran d'accueil et marche avec peu de données, même sans connexion.

Faite sur le modèle de l'appli [Révision](https://github.com/kanelimamou-blip/revision) : GitHub Pages et Firebase gratuit.

## Ce que fait l'Étape 1

- **File d'attente** : le client scanne le QR code du salon, choisit sa coupe sur photo, prend un ticket et voit combien de personnes sont avant lui et l'heure où venir. Le téléphone vibre quand son tour arrive. Le patron peut aussi prévenir un client par WhatsApp.
- **Écran d'attente** (`#ecran/CODE`) : un vieux téléphone ou une télé affiche la file et le QR code.
- **Catalogue** : coupes avec photo, prix et durée. Les durées servent à estimer l'attente selon les coiffeurs présents.
- **Caisse** : une coupe encaissée en un geste (espèces, Wave ou Orange Money), totaux du jour et du mois, part de chaque coiffeur, dépenses, bénéfice du mois avec graphique, stock avec alerte, pointage des coiffeurs, QR Wave du salon affiché au client.
- **Coiffeurs** : chacun relie son téléphone avec le code du salon et le code coiffeur. Il voit ses coupes et sa part, pas la recette du salon.
- **Les profils** : patron, coiffeur, client et écran d'attente, tous ouverts depuis l'accueil.
- **Essai et abonnement** : 10 jours gratuits, puis 2 000 F par mois ou 20 000 F par an, payés par Wave ou Orange Money au 78 272 19 20. Le patron déclare son paiement dans l'appli et un admin le valide dans l'appli (Salon > Abonnement). Après l'essai, les règles Firestore bloquent la caisse, les dépenses et le stock d'un salon non abonné, même en contournant l'appli.

## Fichiers

- `docs/` : l'appli (HTML, CSS, JS sans outil de compilation), publiée sur GitHub Pages à chaque modification de `main`.
  - `config.js` : configuration Firebase, prix, numéro de paiement, admins.
  - `store.js` : lecture et écriture des données dans Firestore, avec cache hors connexion.
  - `app.js` : les écrans.
- `firestore.rules` : règles de sécurité à coller dans la console Firebase.

## Mise en ligne de Firebase

L'appli est reliée au projet Firebase `salon-coiffure-f0ee4`. Pour la brancher sur un autre projet :

1. Créer un projet sur https://console.firebase.google.com (plan gratuit Spark).
2. Authentication : activer **Google**, **E-mail/Mot de passe** et **Anonyme**. Ajouter `kanelimamou-blip.github.io` aux domaines autorisés.
3. Firestore Database : créer la base (région `eur3` ou la plus proche), puis coller `firestore.rules` dans l'onglet Règles.
4. Paramètres du projet > Vos applications > Web : copier la configuration dans `FIREBASE_CONFIG`.
5. Après la première connexion du compte admin, copier son identifiant (Salon > Ce téléphone) dans `CFG.admins` et à la place de `UID_ADMIN` dans les règles.
