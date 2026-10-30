"use strict";
// Réglages de l'appli Salon. Modifier ici, puis publier.

// Configuration publique du projet Firebase (pas secrète : la sécurité vient de firestore.rules).
// Tant qu'elle vaut null, l'appli marche en mode démo : tout reste sur le téléphone.
const FIREBASE_CONFIG = null;

const CFG = {
  trialDays: 10,                       // essai gratuit d'un salon
  priceMonth: 2000,                    // F CFA par mois et par salon
  priceYear: 20000,                    // F CFA par an
  payNumber: "78 272 19 20",           // Wave et Orange Money
  // Identifiants (uid Firebase) des comptes qui valident les paiements, affichés dans Salon > Mon compte
  admins: [],
};
