/**
 * Moyens de réception proposés au client, selon son pays, quand le mandataire lui demande
 * « Par quel moyen souhaitez-vous recevoir l'argent ? ».
 *  - Chaque moyen a un type, qui fixe les informations demandées (Mobile Money : numéro + nom et prénoms…).
 *  - Les moyens locaux (Mobile Money des opérateurs du pays) viennent d'abord, puis les moyens disponibles
 *    presque partout (virement bancaire, crypto, transferts d'espèces) ; PayPal, Wise et Wero seulement dans les
 *    pays où ils permettent de recevoir de l'argent.
 * Liste à compléter au besoin ; Mandix n'est affilié à aucun de ces services.
 */

/** Informations demandées pour chaque type de moyen : [clé, libellé, exemple]. */
export const PAYOUT_FIELD_TYPES = {
  mobile: [["phone", "Numéro de téléphone", "+229 97 00 00 00"], ["holder", "Nom et prénoms", "Ex. Afiavi Hounkpè"]],
  bank: [["iban", "RIB ou IBAN", "FR76 3000 6000 0112 3456 7890 189"], ["holder", "Nom et prénoms du titulaire", "Ex. Afiavi Hounkpè"]],
  crypto: [["address", "Adresse du portefeuille", "Ex. TQ8x… ou bc1q…"], ["network", "Réseau", "Ex. TRC20, BEP20, Bitcoin"]],
  wallet: [["email", "E-mail du compte", "vous@exemple.com"], ["holder", "Nom et prénoms", "Ex. Afiavi Hounkpè"]],
  cash: [["holder", "Nom et prénoms du bénéficiaire", "Ex. Afiavi Hounkpè"], ["city", "Ville de retrait", "Ex. Cotonou"]],
};

const m = (slug, name, type) => ({ slug, name, type });

const BANK = m("virement", "Virement bancaire", "bank");
const CRYPTO = m("crypto", "Crypto", "crypto");
const WESTERN_UNION = m("westernunion", "Western Union", "cash");
const MONEYGRAM = m("moneygram", "MoneyGram", "cash");
const PAYPAL = m("paypal", "PayPal", "wallet");
const WISE = m("wise", "Wise", "wallet");
const WERO = m("wero", "Wero", "mobile");

const MTN = m("mtn_momo", "MTN Mobile Money", "mobile");
const ORANGE = m("orange_money", "Orange Money", "mobile");
const MOOV = m("moov_money", "Moov Money", "mobile");
const WAVE = m("wave", "Wave", "mobile");
const AIRTEL = m("airtel_money", "Airtel Money", "mobile");

/** Moyens locaux par pays (codes ISO 3166-1 de content/countries.js). */
const LOCAL = {
  BJ: [MTN, MOOV, m("celtiis_cash", "Celtiis Cash", "mobile")],
  TG: [m("flooz", "Flooz (Moov Africa)", "mobile"), m("mixx_yas_tg", "Mixx by Yas (ex T-Money)", "mobile")],
  CI: [ORANGE, MTN, MOOV, WAVE],
  SN: [ORANGE, WAVE, m("mixx_yas_sn", "Mixx by Yas (ex Free Money)", "mobile")],
  ML: [ORANGE, MOOV, WAVE],
  BF: [ORANGE, MOOV],
  NE: [AIRTEL, MOOV],
  CM: [MTN, ORANGE],
  CG: [MTN, AIRTEL],
  GA: [AIRTEL, MOOV],
  CD: [m("mpesa", "M-Pesa", "mobile"), ORANGE, AIRTEL],
  GN: [ORANGE, MTN],
  MG: [m("mvola", "MVola", "mobile"), ORANGE, AIRTEL],
  HT: [m("moncash", "MonCash", "mobile"), m("natcash", "NatCash", "mobile")],
  FR: [WERO, PAYPAL, WISE],
  BE: [WERO, PAYPAL, WISE],
  DE: [WERO, PAYPAL, WISE],
  ES: [PAYPAL, WISE],
  IT: [PAYPAL, WISE],
  LU: [PAYPAL, WISE],
  CH: [PAYPAL, WISE],
  GB: [PAYPAL, WISE],
  US: [PAYPAL, WISE],
  CA: [PAYPAL, WISE],
  AE: [PAYPAL, WISE],
};

/** Disponibles dans tous les pays proposés. */
const EVERYWHERE = [BANK, CRYPTO, WESTERN_UNION, MONEYGRAM];

/** Moyens de réception d'un pays : locaux d'abord, puis universels (sans doublon). */
export function payoutMethodsFor(country) {
  const seen = new Set();
  return [...(LOCAL[country] ?? []), ...EVERYWHERE].filter((method) => !seen.has(method.slug) && seen.add(method.slug));
}

export const payoutMethod = (country, slug) => payoutMethodsFor(country).find((method) => method.slug === slug) ?? null;

/** Nom d'un moyen d'après son identifiant (affichage d'une transaction). */
export function payoutMethodName(slug) {
  for (const list of [...Object.values(LOCAL), EVERYWHERE]) {
    const found = list.find((method) => method.slug === slug);
    if (found) return found.name;
  }
  return slug;
}
