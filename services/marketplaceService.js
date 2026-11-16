/**
 * Marketplace des mandataires : recherche, filtres, profils.
 * - Données réelles via les vues publiques sécurisées (models/PublicMandataire.js) : mandataires actifs ayant au
 *   moins un compte publié, sans jamais leurs coordonnées de réception.
 * - Profils fictifs (content/demo-mandataires.js) seulement si DEMO_MARKETPLACE=true, hors production (revue du design).
 * Les vues reçoivent toujours la même forme de données (voir toCard / toProfile).
 */
import config from "../config/app.js";
import { DEMO_MANDATAIRES } from "../content/demo-mandataires.js";
import { COUNTRIES, countryName } from "../content/countries.js";
import { ACCOUNT_TYPES, accountTypeName } from "../content/account-types.js";
import { PublicMandataire } from "../models/PublicMandataire.js";
import { avatarSvg, defaultAvatarSpec } from "../utils/avatar.js";
import { isCertified } from "../utils/badges.js";
import { presence } from "../utils/presence.js";
import { limitForTransactions, limitLabel, tierFor } from "../utils/limits.js";
import { feeLabel } from "../utils/accountRates.js";

export const isDemo = () => config.demoContent && config.demoMarketplace;

const unique = (list) => [...new Set(list)];
const MINUTE = 60 * 1000;

/** Texte comparable sans accents ni majuscules (recherche par nom). */
const normalize = (text) => String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function responseLabel(hours) {
  if (hours == null) return null;
  if (hours <= 1) return "Répond en moins d'1 h";
  if (hours <= 24) return `Répond en moins de ${hours} h`;
  return "Répond sous quelques jours";
}

/**
 * Tarifs du compte phare de la carte (celui de la ligne « Compte » : le premier compte du mandataire, ou celui
 * qui correspond à la recherche). Chacun vaut null si ce compte ne l'indique pas ; les autres comptes ne comptent pas.
 *  - leadFee : « 25 % » ; leadRate : « 100 € = 45 000 FCFA ».
 */
const leadFeeOf = (account) => (account && account.feePercent != null ? feeLabel(account.feePercent) : null);
const leadRateOf = (account) => account?.rateLabel ?? null;

/** Carte de résultat (même forme en démo et en réel). */
function toCard(m) {
  const fullName = `${m.firstName} ${m.lastName || ""}`.trim();
  const accounts = m.accounts ?? [];
  const typeSlugs = unique(accounts.map((a) => a.type));
  // Pays des comptes (libre, indépendant de la nationalité du mandataire, qui est facultative).
  const accountCountries = unique(accounts.map((a) => a.country).filter(Boolean));
  const level = m.levelTransactions ?? m.transactions ?? 0; // transactions qui comptent pour le niveau
  return {
    slug: m.slug,
    firstName: m.firstName,
    lastName: m.lastName,
    fullName,
    id: m.id ?? null,
    typeLabel: "Mandataire",
    countryCode: m.country ?? null,
    countryName: m.country ? countryName(m.country) : null,
    city: m.city ?? null,
    avatar: avatarSvg(m.avatar ?? defaultAvatarSpec(m.slug), { size: 56, label: `Avatar de ${fullName}` }),
    avatarSpec: m.avatar ?? defaultAvatarSpec(m.slug),
    rating: m.rating ?? null,
    reviewsCount: m.reviewsCount ?? 0,
    accountsOpened: m.accountsOpened ?? null,
    yearsExperience: m.yearsExperience ?? null,
    memberSince: m.joinedAt ?? null,
    languages: m.languages ?? [],
    banks: (m.banks ?? []).map((b) => b.name),
    accountTypeSlugs: typeSlugs,
    accountTypes: typeSlugs.map(accountTypeName),
    accountsCount: accounts.length,
    accountCountries: accountCountries.map((code) => ({ code, name: countryName(code) })),
    accountPairs: accounts.map((a) => ({ type: a.type, country: a.country, feePercent: a.feePercent ?? null, rateLabel: a.rateLabel ?? null })),
    leadFee: leadFeeOf(accounts[0]),
    leadRate: leadRateOf(accounts[0]),
    remote: accounts.some((a) => a.remote),
    responseHours: m.responseHours ?? null,
    responseLabel: responseLabel(m.responseHours),
    // Badge « vérifié » : uniquement si la vérification a été faite (la vue publique ne contient que des profils approuvés).
    verified: m.verified === true,
    // Plafond par transaction : déduit des transactions réussies (utils/limits.js) ; bloqué pendant une restriction.
    limitEur: limitForTransactions(level), // null au niveau 10 : sans plafond
    limitLabel: limitLabel(limitForTransactions(level)),
    level: tierFor(level).level,
    transactions: m.transactions ?? 0, // transactions réussies
    rejected: m.rejected ?? 0, // transactions rejetées (statistiques du profil)
    certified: isCertified(m.transactions ?? 0),
    presence: presence(m.lastSeenAt ?? null),
  };
}

/** Données de démo : la dernière activité est exprimée en minutes avant le chargement de la page. */
const fromDemo = (m) => ({ ...m, verified: false, lastSeenAt: new Date(Date.now() - (m.lastSeenMinutes ?? 0) * MINUTE) });

function toProfile(m) {
  return {
    ...toCard(m),
    avatarLarge: avatarSvg(m.avatar ?? defaultAvatarSpec(m.slug), { size: 128, label: `Avatar de ${m.firstName} ${m.lastName}` }),
    bio: m.bio,
    banksDetailed: m.banks ?? [],
    accounts: (m.accounts ?? []).map((a) => ({ ...a, typeName: accountTypeName(a.type), countryName: countryName(a.country) })),
    qualifications: m.qualifications ?? [],
    reviews: m.reviews ?? [],
  };
}

/* ------------------------------------------------------------------ Référentiels des filtres */

/** Pays proposés dans les filtres (démonstration : pays où un mandataire fictif a un compte). */
export function listCountries() {
  if (!isDemo()) return COUNTRIES.map((c) => ({ code: c.code, name: c.name, count: null })).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const counts = {};
  DEMO_MANDATAIRES.forEach((m) => { unique((m.accounts ?? []).map((a) => a.country)).forEach((code) => { counts[code] = (counts[code] ?? 0) + 1; }); });
  return Object.entries(counts)
    .map(([code, count]) => ({ code, name: countryName(code), count }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export function listBanks() {
  if (!isDemo()) return [];
  return unique(DEMO_MANDATAIRES.flatMap((m) => (m.banks ?? []).map((b) => b.name))).sort((a, b) => a.localeCompare(b, "fr"));
}

export function listLanguages() {
  if (!isDemo()) return [];
  return unique(DEMO_MANDATAIRES.flatMap((m) => m.languages ?? [])).sort((a, b) => a.localeCompare(b, "fr"));
}

export const listAccountTypes = () => ACCOUNT_TYPES;

/** Lit les filtres de l'URL en ne gardant que des valeurs connues (jamais de saisie brute réinjectée). */
export function readFilters(query = {}) {
  const pick = (value, allowed) => (typeof value === "string" && allowed.includes(value) ? value : "");
  return {
    pays: pick(query.pays, listCountries().map((c) => c.code)),
    type: pick(query.type, ACCOUNT_TYPES.map((t) => t.slug)),
    banque: pick(query.banque, listBanks()),
    langue: pick(query.langue, listLanguages()),
    distance: pick(query.distance, ["oui"]),
    tri: pick(query.tri, ["pertinence", "note", "reponse"]) || "pertinence",
    // Saisies libres : longueur bornée, toujours échappées à l’affichage, jamais injectées dans une requête brute.
    nom: typeof query.nom === "string" ? query.nom.replace(/\s+/g, " ").trim().slice(0, 60) : "",
    somme: readAmount(query.somme),
  };
}

/** Montant entier positif (espaces tolérés), sinon chaîne vide. */
function readAmount(value) {
  if (typeof value !== "string") return "";
  const digits = value.replace(/[\s\u00a0\u202f]/g, "");
  if (!/^\d{1,9}$/.test(digits)) return "";
  const amount = Number(digits);
  return amount > 0 ? String(amount) : "";
}

export const ACTIVE_FILTER_KEYS = ["pays", "type", "nom", "somme", "banque", "langue", "distance"];

/* ------------------------------------------------------------------ Recherche */

/**
 * Filtres : pays (code ISO), type (slug de compte), nom (texte), somme (montant couvert par le plafond),
 * banque (nom), langue, distance ("oui"),
 * tri ("pertinence" | "note" | "reponse").
 */
export async function search(filters = {}) {
  const source = isDemo() ? DEMO_MANDATAIRES.map(fromDemo) : await PublicMandataire.list();
  let results = source.map(toCard);
  // « Compte » et « Pays » portent sur un même compte du mandataire (ex. PayPal ouvert en France).
  if (filters.pays || filters.type) {
    const matches = (a) => (!filters.pays || a.country === filters.pays) && (!filters.type || a.type === filters.type);
    results = results.filter((m) => m.accountPairs.some(matches)).map((m) => {
      const hit = m.accountPairs.find(matches);
      const first = (list, key) => [...list.filter((x) => key(x)), ...list.filter((x) => !key(x))];
      return {
        ...m,
        // La carte montre d'abord le compte et le pays recherchés, avec les tarifs de ce compte-là.
        accountTypes: first(m.accountTypeSlugs, (slug) => slug === hit.type).map(accountTypeName),
        accountCountries: first(m.accountCountries, (c) => c.code === hit.country),
        leadFee: leadFeeOf(hit),
        leadRate: leadRateOf(hit),
      };
    });
  }
  if (filters.nom) {
    const needle = normalize(filters.nom);
    results = results.filter((m) => normalize(m.fullName).includes(needle));
  }
  if (filters.somme) results = results.filter((m) => m.limitEur == null || m.limitEur >= Number(filters.somme));
  if (filters.banque) results = results.filter((m) => m.banks.includes(filters.banque));
  if (filters.langue) results = results.filter((m) => m.languages.includes(filters.langue));
  if (filters.distance === "oui") results = results.filter((m) => m.remote);

  const byRating = (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.reviewsCount - a.reviewsCount;
  const byResponse = (a, b) => (a.responseHours ?? 99) - (b.responseHours ?? 99) || byRating(a, b);
  const relevance = (m) => (m.rating ?? 0) * 10 + Math.log10(m.reviewsCount + 1) * 4 - (m.responseHours ?? 24) * 0.5;
  if (filters.tri === "note") results.sort(byRating);
  else if (filters.tri === "reponse") results.sort(byResponse);
  else results.sort((a, b) => relevance(b) - relevance(a));

  return results;
}

export async function featured(limit = 3) {
  return (await search({ tri: "pertinence" })).slice(0, limit);
}

export async function getProfile(slug) {
  if (!isDemo()) {
    const m = await PublicMandataire.findBySlug(slug);
    return m ? toProfile(m) : null;
  }
  const m = DEMO_MANDATAIRES.find((item) => item.slug === slug);
  return m ? toProfile(fromDemo(m)) : null;
}

/** Avis récents pour l'accueil (démonstration ; en réel : PublicMandataire.recentReviews). */
export function recentDemoReviews(limit = 3) {
  return DEMO_MANDATAIRES.flatMap((m) =>
    m.reviews.map((r) => ({ ...r, mandataireName: `${m.firstName} ${m.lastName}`, mandataireSlug: m.slug, city: m.city, country: countryName(m.country) }))
  )
    .sort((a, b) => b.date - a.date)
    .slice(0, limit);
}
