/**
 * Emplacements photo du site. Le fichier optimisé (WebP) se trouve dans public/images/photos/<clé>.webp ;
 * les originaux sont conservés hors du dossier public, dans assets/photos-sources/.
 * Tant qu'un fichier manque, un visuel de remplacement s'affiche.
 *
 * Règle : une photo de banque d'images illustre une section. Elle n'est JAMAIS utilisée comme
 * photo de profil d'un mandataire, ni associée à un nom ou à un avis.
 * Licence Pexels : utilisation libre, attribution appréciée (champ `credit`).
 */
export const PHOTO_SLOTS = {
  "hero-principale": {
    alt: "Un conseiller serre la main d'une cliente à son bureau, des documents sur la table",
    label: "Photo principale de la bannière",
    icon: "users",
    credit: "Yan Krukov / Pexels",
  },
  "hero-secondaire": {
    alt: "Un homme en tenue traditionnelle bleue, assis et souriant",
    label: "Photo secondaire de la bannière",
    icon: "user",
    credit: "Jboy Designer / Pexels",
  },
  "accueil-rencontre": {
    alt: "Un professionnel souriant accueille un client d'une poignée de main",
    label: "Rencontre entre un professionnel et un client",
    icon: "users",
    credit: "Kindel Media / Pexels",
  },
  "accueil-verification": {
    alt: "Des documents officiels remis de la main à la main",
    label: "Vérification de documents",
    icon: "file-check",
    credit: "Mikhail Nilov / Pexels",
  },
  "accueil-professionnel": {
    alt: "Une professionnelle en tailleur, souriante, dans une rue commerçante",
    label: "Portrait d'un professionnel",
    icon: "user-check",
    credit: "AKB PH / Pexels",
  },
  "auth-connexion": {
    alt: "Un professionnel souriant, les bras croisés sur une table, dans un café",
    label: "Photo de la page de connexion",
    icon: "user",
    credit: "Lahbabi / Pexels",
  },
  "auth-inscription": {
    alt: "Un conseiller accompagne une cliente dans ses démarches, à son bureau",
    label: "Photo de la page d'inscription",
    icon: "users",
    credit: "Karola G / Pexels",
  },
  "auth-pro": {
    alt: "Un professionnel en costume à son bureau, prêt à recevoir un client",
    label: "Photo de l'inscription professionnelle",
    icon: "briefcase",
    credit: "Anthony Shkraba / Pexels",
  },
  "apropos-conseil": {
    alt: "Un conseiller présente un document à un couple lors d'un rendez-vous",
    label: "Rendez-vous de conseil",
    icon: "users",
    credit: "Karola G / Pexels",
  },
};
