"use strict";
// Réglages de l'appli Salon. Modifier ici, puis publier.

// Configuration publique du projet Firebase (pas secrète : la sécurité vient de firestore.rules).
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDIeME3QSYUJijIb3YChFAW2eXOTrqF0q4",
  authDomain: "salon-coiffure-f0ee4.firebaseapp.com",
  projectId: "salon-coiffure-f0ee4",
  storageBucket: "salon-coiffure-f0ee4.firebasestorage.app",
  messagingSenderId: "529449051386",
  appId: "1:529449051386:web:aae563d3727ae80daa1543",
};

const CFG = {
  version: "2026-10-31",              // à changer à chaque mise en ligne : l'admin voit quelle version tourne sur chaque téléphone
  contact: "78 272 19 20",             // numéro de l'équipe de l'appli, affiché à un salon suspendu
  prix: { mois: 2000, an: 20000, essaiJours: 30 },  // abonnement payé hors de l'appli (rappelé dans les relances WhatsApp)
  // Comptes qui ouvrent l'espace admin (#admin) : identifiant affiché sur cette page, à copier ici
  // et à la place de UID_ADMIN dans firestore.rules.
  // Le paiement de l'abonnement se fait hors de l'appli ; l'espace admin sert à superviser et à suspendre un salon
  admins: ["tBGAaRZCZjhVm5gkb414ObcF7Cf2"],
};
