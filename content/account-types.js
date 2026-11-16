/**
 * Comptes (moyens de paiement et de transfert) sur lesquels un mandataire accompagne ses clients.
 * Ordre d'affichage voulu par le client. logo : public/images/services/<slug>.svg (voir LISEZMOI.txt).
 * Mandix n'est affilié à aucun de ces services ; les marques appartiennent à leurs propriétaires.
 */
/**
 * Coordonnées que le mandataire indique pour recevoir l'argent sur ce compte (libellé et exemple du champ).
 * Jamais de mot de passe, code secret, numéro de carte ni phrase de récupération (contrôlé à la saisie).
 */
export const DEFAULT_RECEIVE = { receiveLabel: "Coordonnées de réception", receivePlaceholder: "IBAN, e-mail, identifiant du compte…" };
const RECEIVE = {
  paypal: { receiveLabel: "Adresse e-mail PayPal", receivePlaceholder: "vous@exemple.com" },
  stripe: { receiveLabel: "E-mail ou identifiant du compte Stripe", receivePlaceholder: "vous@exemple.com" },
  wise: { receiveLabel: "IBAN ou e-mail Wise", receivePlaceholder: "BE68 5390 0754 7034 ou vous@exemple.com" },
  virement: { receiveLabel: "IBAN", receivePlaceholder: "FR76 3000 6000 0112 3456 7890 189" },
  transcash: { receiveLabel: "Référence du compte Transcash", receivePlaceholder: "Référence indiquée dans votre espace Transcash" },
  neosurf: { receiveLabel: "Identifiant myNeosurf", receivePlaceholder: "Identifiant ou e-mail myNeosurf" },
  paysafecard: { receiveLabel: "Identifiant my paysafecard", receivePlaceholder: "Identifiant ou e-mail my paysafecard" },
  wero: { receiveLabel: "Téléphone ou e-mail Wero", receivePlaceholder: "+33 6 12 34 56 78" },
  pcs: { receiveLabel: "IBAN de la carte PCS Mastercard", receivePlaceholder: "FR76 …" },
  skrill: { receiveLabel: "Adresse e-mail Skrill", receivePlaceholder: "vous@exemple.com" },
  westernunion: { receiveLabel: "Nom complet et pays du bénéficiaire", receivePlaceholder: "Prénom Nom — Ville, Pays" },
  moneygram: { receiveLabel: "Nom complet et pays du bénéficiaire", receivePlaceholder: "Prénom Nom — Ville, Pays" },
  crypto: { receiveLabel: "Adresse de portefeuille (publique) et réseau", receivePlaceholder: "Ex. bc1q… (réseau Bitcoin)" },
};

/**
 * Comptes qui demandent une option au moment d'envoyer de l'argent. Proposée au mandataire quand il envoie
 * ses coordonnées, et au client quand il indique le compte sur lequel recevoir l'argent.
 * Pour en ajouter une : une entrée ici suffit (clés à reporter dans database/schema.sql, colonnes *_option).
 */
export const ACCOUNT_OPTIONS = {
  paypal: { label: "Type d'envoi", choose: "le type d'envoi PayPal", items: [["friends_family", "Amis et proches"], ["goods_services", "Biens et services"]] },
  virement: { label: "Mode de virement", choose: "le mode de virement", items: [["instant", "Virement instantané"], ["classic", "Virement classique"]] },
};

export const ACCOUNT_TYPES = [
  { slug: "paypal", name: "PayPal", description: "Création, vérification et utilisation d'un compte PayPal." },
  { slug: "stripe", name: "Stripe", description: "Mise en place d'un compte Stripe pour encaisser vos ventes en ligne." },
  { slug: "wise", name: "Wise", description: "Compte multidevise Wise pour envoyer et recevoir à l'international." },
  { slug: "virement", name: "Virement", description: "Accompagnement pour vos virements bancaires, en France ou à l'étranger." },
  { slug: "transcash", name: "Transcash", description: "Achat et utilisation de tickets de recharge Transcash." },
  { slug: "neosurf", name: "Neosurf", description: "Paiement en ligne avec des tickets prépayés Neosurf." },
  { slug: "paysafecard", name: "Paysafecard", description: "Paiement en ligne avec des codes prépayés Paysafecard." },
  { slug: "wero", name: "Wero", description: "Paiements instantanés entre particuliers avec Wero." },
  { slug: "pcs", name: "PCS Mastercard", description: "Carte prépayée PCS Mastercard : obtention et recharge." },
  { slug: "skrill", name: "Skrill", description: "Portefeuille électronique Skrill pour vos paiements en ligne." },
  { slug: "westernunion", name: "Western Union", description: "Envoi et réception d'argent via Western Union." },
  { slug: "moneygram", name: "MoneyGram", description: "Envoi et réception d'argent via MoneyGram." },
  { slug: "crypto", name: "Crypto", description: "Portefeuille de cryptomonnaies : ouverture et utilisation en sécurité." },
].map((t) => ({ ...t, logo: `/images/services/${t.slug}.svg`, ...(RECEIVE[t.slug] ?? DEFAULT_RECEIVE), options: ACCOUNT_OPTIONS[t.slug] ?? null }));

export const accountTypeName = (slug) => ACCOUNT_TYPES.find((t) => t.slug === slug)?.name ?? slug;

/** Logo d'un service (image locale, décorative : le nom est toujours écrit à côté). */
export function serviceLogo(slug, { size = 20, className = "" } = {}) {
  const type = ACCOUNT_TYPES.find((t) => t.slug === slug);
  if (!type) return "";
  return `<img class="service-logo ${className}" src="${type.logo}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">`;
}
