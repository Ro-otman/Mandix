/**
 * Plafond des mandataires et conversion en euros (devise de référence de la plateforme).
 * - Dix niveaux, atteints selon le nombre de transactions terminées (évaluées) : 20, 30, 50, 70, 100, 200, 300,
 *   500, 700 et 1 000 transactions (plafond = 10 € par transaction du palier). Un nouveau mandataire (moins de
 *   20 transactions) est au niveau 1. Le niveau 10 (1 000 transactions) n'a plus de plafond (« +10 000 € ») et
 *   donne la certification.
 * - Taux de conversion INDICATIFS (démonstration) : à remplacer par un service de taux de change côté serveur.
 *   XOF et XAF : parité fixe avec l'euro (655,957).
 */
import { formatEur } from "./format.js";

/** Niveaux : atteints à `from` transactions ; plafond de `limitEur` par transaction (null : sans plafond). */
export const LIMIT_TIERS = [
  { level: 1, from: 0, limitEur: 200 }, // palier annoncé à 20 transactions ; s'applique dès l'inscription
  { level: 2, from: 30, limitEur: 300 },
  { level: 3, from: 50, limitEur: 500 },
  { level: 4, from: 70, limitEur: 700 },
  { level: 5, from: 100, limitEur: 1000 },
  { level: 6, from: 200, limitEur: 2000 },
  { level: 7, from: 300, limitEur: 3000 },
  { level: 8, from: 500, limitEur: 5000 },
  { level: 9, from: 700, limitEur: 7000 },
  { level: 10, from: 1000, limitEur: null, certification: true },
];

/** Au-delà de ce montant, sans plafond (libellé du dernier niveau : « +10 000 € »). */
export const UNLIMITED_FROM_EUR = 10000;

/** Niveau atteint pour un nombre de transactions. */
export function tierFor(count) {
  let found = LIMIT_TIERS[0];
  for (const tier of LIMIT_TIERS) if (Number(count) >= tier.from) found = tier;
  return found;
}

/** Plafond par transaction en euros ; null au niveau 10 (au-delà de 10 000 €, sans limite). */
export const limitForTransactions = (count) => tierFor(count).limitEur;

/** Libellé du plafond : « 3 000 € », ou « +10 000 € » au niveau 10. */
export const limitLabel = (limitEur) => (limitEur == null ? `+${formatEur(UNLIMITED_FROM_EUR)}` : formatEur(limitEur));

/** Libellé du plafond pour un nombre de transactions. */
export const limitLabelFor = (count) => limitLabel(limitForTransactions(count));

/** Nombre d'unités de chaque devise pour 1 euro (indicatif). */
export const EUR_RATES = {
  EUR: 1, XOF: 655.957, XAF: 655.957, USD: 1.08, CAD: 1.48, CHF: 0.94, GBP: 0.85,
  MAD: 10.8, TND: 3.4, DZD: 145, AED: 3.97, GNF: 9300, CDF: 3050, MGA: 4900, HTG: 142,
};

export const toEur = (amount, currency) => Number(amount) / (EUR_RATES[currency] ?? 1);
