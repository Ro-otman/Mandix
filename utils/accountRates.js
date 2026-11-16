/**
 * Tarifs et coordonnées des comptes des mandataires (cases à cocher de l'ajout de compte) :
 *  - réception : E-mail et/ou RIB (chiffrés en base, jamais affichés publiquement) ;
 *  - « Prix sur 100 » : pour 100 unités d'une devise choisie par le mandataire (liste de toutes les devises),
 *    le montant versé dans une autre devise de la liste (ex. 100 € = 65 000 FCFA) ;
 *  - « Pourcentage » prélevé sur la transaction (ex. 25 %).
 * Les tarifs sont publics (profil du mandataire).
 */
import { formatNumber } from "./format.js";
import { currencySymbol } from "../content/currencies.js";

/**
 * « 100 € = 65 000 FCFA ». rate.symbol et rate.unit sont des codes de devise (EUR, XOF…) choisis dans les listes
 * du formulaire ; affichés avec leur symbole.
 */
export const rateLabel = (rate) =>
  (rate ? `100 ${currencySymbol(rate.symbol)} = ${formatNumber(rate.amount)} ${currencySymbol(rate.unit)}` : null);

/** « 25 % » */
export const feeLabel = (percent) => (percent == null ? null : `${formatNumber(percent)} %`);

/** Nombre saisi en français (« 65 000 », « 2,5 ») ; null si invalide. */
export function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const compact = value.replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(compact)) return null;
  return Number(compact);
}

/** Pourcentage saisi avec ou sans le signe : « 25 », « 25% », « 25 % », « 2,5 % ». */
export const parsePercent = (value) => parseAmount(typeof value === "string" ? value.replace(/%/g, "") : value);

/**
 * Coordonnées de réception (cases à cocher), dans l'ordre d'affichage, avec leur libellé.
 * Toutes privées : chiffrées en base, envoyées au client seulement dans la messagerie.
 */
export const RECEIVE_FIELDS = [
  ["holder", "Titulaire"],
  ["email", "E-mail"],
  ["rib", "RIB"],
  ["bic", "BIC"],
  ["address", "Adresse"],
];
const RECEIVE_KEYS = RECEIVE_FIELDS.map(([key]) => key);

/**
 * Coordonnées chiffrées : JSON { v: 2, holder, email, rib, bic, address } (seules les cases cochées).
 * Les comptes ajoutés avant les cases à cocher ont un texte libre, conservé tel quel.
 */
export const encodeReceive = (receive = {}) =>
  JSON.stringify({ v: 2, ...Object.fromEntries(RECEIVE_KEYS.filter((k) => receive[k]).map((k) => [k, receive[k]])) });

export function decodeReceive(text) {
  const empty = Object.fromEntries(RECEIVE_KEYS.map((k) => [k, ""]));
  if (typeof text === "string" && text.startsWith("{")) {
    try {
      const data = JSON.parse(text);
      if (data && data.v === 2) return { ...empty, ...Object.fromEntries(RECEIVE_KEYS.map((k) => [k, data[k] || ""])), legacy: "" };
    } catch {
      /* texte libre commençant par « { » : traité comme un ancien compte */
    }
  }
  return { ...empty, legacy: String(text ?? "") };
}

/**
 * Texte envoyé au client dans la messagerie (et copié d'un clic) : une seule coordonnée → sa valeur seule ;
 * plusieurs → une ligne étiquetée par coordonnée (« Titulaire : … », « RIB : … », « BIC : … »…).
 */
export function receiveText(details) {
  if (details.legacy) return details.legacy;
  const filled = RECEIVE_FIELDS.filter(([key]) => details[key]);
  if (filled.length === 1) return details[filled[0][0]];
  return filled.map(([key, label]) => `${label} : ${details[key]}`).join("\n");
}
