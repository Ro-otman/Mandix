/**
 * Formatage pour l'affichage (exposé aux vues via res.locals.fmt).
 * Dates stockées en UTC, affichées dans le fuseau Africa/Porto-Novo.
 */
import config from "../config/app.js";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", { timeZone: config.timezone, dateStyle: "long" });
const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: config.timezone,
  dateStyle: "medium",
  timeStyle: "short",
});
const currencyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: config.currency,
  maximumFractionDigits: 0,
});

const monthYearFormatter = new Intl.DateTimeFormat("fr-FR", { timeZone: config.timezone, month: "long", year: "numeric" });
/** « mars 2024 » (ex. « Membre depuis mars 2024 »). */
export const formatMonthYear = (value) => (value ? monthYearFormatter.format(new Date(value)) : "");
export const formatDate = (value) => (value ? dateFormatter.format(new Date(value)) : "");
export const formatDateTime = (value) => (value ? dateTimeFormatter.format(new Date(value)) : "");
/** Montant en FCFA (XOF n'a pas de subdivision : entiers uniquement). */
export const formatXof = (amount) => currencyFormatter.format(Number(amount) || 0);

const eurFormatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const numberFormatter = new Intl.NumberFormat("fr-FR");

// Intl utilise une espace fine insécable (U+202F), presque invisible en petit corps : on la remplace
// par une espace insécable classique pour que « 1 240 » reste lisible.
const readableSpaces = (text) => text.replace(/\u202f/g, "\u00a0");

/** Montant en euros, sans décimales (plafonds des mandataires). */
export const formatEur = (amount) => readableSpaces(eurFormatter.format(Number(amount) || 0));
/** Nombre avec séparateur de milliers français (« 1 240 »). */
export const formatNumber = (value) => readableSpaces(numberFormatter.format(Number(value) || 0));
