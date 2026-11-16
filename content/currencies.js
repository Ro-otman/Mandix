/**
 * Toutes les devises en cours (ISO 4217), noms en français, fournies par Intl (aucune liste à maintenir).
 * Utilisées par les listes « Devise » et « Prix sur 100 » de l'ajout de compte, et pour l'affichage des tarifs.
 *  - Exclus : métaux précieux, unités de compte et anciennes devises (« (1964—2022) »…).
 *  - Symbole affiché : « FCFA » pour XOF / XAF, symboles courants (€, $, £…), sinon le code (« 100 CAD »).
 *  - Ordre : devises les plus utilisées sur Mandix d'abord, puis toutes les autres par nom.
 */
const SPECIAL = new Set(["XAG", "XAU", "XPD", "XPT", "XDR", "XSU", "XUA", "XBA", "XBB", "XBC", "XBD", "XTS", "XXX"]);
const SYMBOLS = { XOF: "FCFA", XAF: "FCFA", EUR: "€", USD: "$", GBP: "£", JPY: "¥", CNY: "¥", INR: "₹", NGN: "₦", GHS: "GH₵", GNF: "FG" };
const PREFERRED = ["XOF", "XAF", "EUR", "USD", "GBP", "CAD", "CHF", "MAD", "TND", "DZD", "GNF", "CDF", "NGN", "GHS", "AED", "MGA", "HTG"];

const names = new Intl.DisplayNames(["fr"], { type: "currency" });
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function symbolOf(code) {
  if (SYMBOLS[code]) return SYMBOLS[code];
  try {
    const narrow = new Intl.NumberFormat("fr-FR", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
      .formatToParts(1).find((p) => p.type === "currency")?.value;
    // « $ » seul est ambigu (dollar canadien, australien…) : le code est plus clair.
    return narrow && narrow !== "$" ? narrow : code;
  } catch {
    return code;
  }
}

const all = (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : PREFERRED)
  .filter((code) => !SPECIAL.has(code))
  .map((code) => ({ code, name: capitalize(names.of(code) || code), symbol: symbolOf(code) }))
  .filter((c) => !/\(\d{4}/.test(c.name)); // anciennes devises : « dollar zimbabwéen (2009) »

const rank = (code) => (PREFERRED.includes(code) ? PREFERRED.indexOf(code) : PREFERRED.length);

export const CURRENCIES = all.sort((a, b) => rank(a.code) - rank(b.code) || a.name.localeCompare(b.name, "fr"));
export const CURRENCY_CODES = new Set(CURRENCIES.map((c) => c.code));

/** Libellé d'une option de liste : « XOF — Franc CFA (BCEAO) ». */
export const currencyOption = (c) => `${c.code} — ${c.name}`;

/** Symbole d'affichage d'un code (« FCFA », « € ») ; une valeur inconnue (anciens tarifs saisis à la main) reste telle quelle. */
export const currencySymbol = (value) => CURRENCIES.find((c) => c.code === value)?.symbol ?? value;
