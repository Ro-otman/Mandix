import { PublicMandataire } from "../models/PublicMandataire.js";
import * as marketplace from "../services/marketplaceService.js";
import { avatarSvg } from "../utils/avatar.js";
import { homeFaq } from "../content/faq.js";
import { helpTopics } from "../content/help.js";
import { LIMIT_TIERS, limitLabel } from "../utils/limits.js";

// Avatars illustratifs du hero (personnages génériques, ne représentent aucun inscrit).
const HERO_AVATARS = [
  { skin: 4, hair: "headwrap", outfit: "emerald", background: "menthe" },
  { skin: 5, hair: "short", outfit: "navy", background: "brume", accessory: "glasses" },
  { skin: 3, hair: "braids", outfit: "white", background: "or" },
  { skin: 6, hair: "fade", outfit: "blue", background: "sable" },
].map((spec) => avatarSvg(spec, { size: 44 }));

async function loadReviews() {
  if (marketplace.isDemo()) {
    return marketplace.recentDemoReviews(3).map((r) => ({
      rating: r.rating,
      comment: r.comment,
      author_display_name: r.author,
      mandataire_name: r.mandataireName,
      mandataire_place: `${r.city}, ${r.country}`,
      created_at: r.date,
    }));
  }
  return PublicMandataire.recentReviews(3);
}

export async function showHome(req, res) {
  const [featuredMandataires, reviews] = await Promise.all([marketplace.featured(3), loadReviews()]);

  const countries = marketplace.listCountries();
  res.render("public/home", {
    title: null, // titre par défaut (nom de la plateforme + promesse)
    extraStyles: ["marketplace", "spaces"],
    publicDrawer: true, // « Voir le profil » ouvre la fiche comme dans l'espace client
    countries,
    accountTypes: marketplace.listAccountTypes(),
    filters: marketplace.readFilters({}),
    featuredMandataires,
    reviews,
    heroAvatar: avatarSvg(HERO_AVATARS[0], { size: 44 }),
    limitTiers: LIMIT_TIERS.map((t) => ({ ...t, label: limitLabel(t.limitEur) })),
    faq: homeFaq,
  });
}

export function showHowItWorks(req, res) {
  res.render("public/how-it-works", { title: "Comment ça marche", extraStyles: ["pages"] });
}

export function showBecomeProvider(req, res) {
  res.render("public/become-provider", { title: "Devenir prestataire", extraStyles: ["pages"] });
}

/** Sujets du formulaire de contact ; « signalement » est présélectionné depuis le bouton « Signaler » d'une fiche. */
const CONTACT_SUBJECTS = [
  ["signalement", "Signaler un mandataire"],
  ["compte", "Question sur un compte"],
  ["probleme", "Problème avec un mandataire"],
  ["messagerie", "Messagerie"],
  ["mon-compte", "Mon compte"],
  ["devenir-mandataire", "Devenir mandataire"],
  ["autre", "Autre"],
];

export async function showHelp(req, res) {
  const subject = CONTACT_SUBJECTS.some(([key]) => key === req.query.sujet) ? req.query.sujet : "";
  // Mandataire signalé : uniquement un profil existant (le slug de l'URL n'est jamais affiché tel quel).
  const slug = typeof req.query.mandataire === "string" && /^[a-z0-9-]{1,140}$/.test(req.query.mandataire) ? req.query.mandataire : null;
  const profile = slug ? await marketplace.getProfile(slug) : null;
  res.render("public/help", {
    title: "Centre d'aide et contact",
    extraStyles: ["pages"],
    helpTopics,
    contactSubjects: CONTACT_SUBJECTS,
    contactSubject: subject,
    reported: profile ? { slug: profile.slug, name: profile.fullName } : null,
  });
}

export function showAbout(req, res) {
  res.render("public/about", { title: "À propos" });
}

const LEGAL_PAGES = {
  "conditions-utilisation": { title: "Conditions d'utilisation" },
  confidentialite: { title: "Politique de confidentialité" },
};

export function showLegal(pageKey) {
  return (req, res) => res.render("public/legal", { title: LEGAL_PAGES[pageKey].title });
}

/**
 * Page temporaire pour les routes des phases suivantes : évite tout lien mort
 * tout en indiquant honnêtement que la fonctionnalité n'est pas encore disponible.
 */
export function comingSoon(title) {
  return (req, res) => res.status(200).render("public/coming-soon", { title });
}

