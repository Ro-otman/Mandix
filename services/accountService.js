/**
 * Comptes de paiement d'un mandataire : ajout (publié aussitôt, coordonnées chiffrées), liste, retrait.
 * Toutes les entrées sont revalidées ici, quelle que soit la vérification faite par le navigateur.
 */
import { COUNTRIES } from "../content/countries.js";
import { CURRENCY_CODES } from "../content/currencies.js";
import { MandataireAccount, accountTypeIds } from "../models/MandataireAccount.js";
import { AuditLog } from "../models/Security.js";
import { sensitiveReason } from "../utils/sensitive.js";
import { parseAmount, parsePercent } from "../utils/accountRates.js";

const COUNTRY_CODES = new Set(COUNTRIES.map((c) => c.code));
// Devise du compte : toutes les devises en cours (content/currencies.js), plus celles des pays proposés.
const CURRENCIES = new Set([...CURRENCY_CODES, ...COUNTRIES.map((c) => c.currency)]);
export const MAX_ACCOUNTS = 30;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const text = (value, max) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max + 1) : "");
const isChecked = (value) => value === true || value === "on" || value === "true" || value === "1";

/**
 * Cases cochées par le mandataire (input.checks) et leurs valeurs. Aucune case n'est obligatoire : il coche
 * seulement ce qui est nécessaire pour ce compte.
 *  - holder (nom et prénoms du titulaire), email, rib, bic, address : où recevoir l'argent (privées, chiffrées ;
 *    sans aucune d'elles, il les saisit dans la messagerie au moment de les envoyer) ;
 *  - price : { symbol, amount, unit } (« Prix sur 100 ») ; percent : pourcentage sur la transaction.
 * @returns {{ receive: object, rate: object|null, feePercent: number|null, errors: Record<string, string> }}
 */
export function readAccountOffer(input = {}) {
  const errors = {};
  const checks = input.checks && typeof input.checks === "object" ? input.checks : {};
  const receive = { holder: "", email: "", rib: "", bic: "", address: "" };

  if (isChecked(checks.holder)) {
    const holder = text(input.holder, 100);
    const reason = sensitiveReason(holder);
    if (reason) errors.holder = reason;
    else if (!/^[\p{L}][\p{L}\p{M}' .-]{1,99}$/u.test(holder)) errors.holder = "Indiquez le nom et les prénoms du titulaire (lettres uniquement).";
    else receive.holder = holder;
  }
  if (isChecked(checks.email)) {
    const email = text(input.email, 120).toLowerCase();
    if (!EMAIL.test(email) || email.length > 120) errors.email = "Indiquez une adresse e-mail valide.";
    else receive.email = email;
  }
  if (isChecked(checks.rib)) {
    const rib = text(input.rib, 60).toUpperCase();
    const reason = sensitiveReason(rib);
    if (reason) errors.rib = reason;
    else if (!/^[A-Z0-9 ]{10,60}$/.test(rib)) errors.rib = "Indiquez le RIB (10 à 60 lettres et chiffres).";
    else receive.rib = rib;
  }
  if (isChecked(checks.bic)) {
    // BIC (SWIFT) : 4 lettres (banque), 2 lettres (pays), 2 caractères (ville), 3 facultatifs (agence).
    const bic = (typeof input.bic === "string" ? input.bic.replace(/\s/g, "") : "").toUpperCase().slice(0, 12);
    if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) errors.bic = "Indiquez un BIC valide : 8 ou 11 caractères (ex. BNPAFRPP).";
    else receive.bic = bic;
  }
  if (isChecked(checks.address)) {
    const address = text(input.address, 160);
    const reason = sensitiveReason(address);
    if (reason) errors.address = reason;
    else if (address.length < 5 || address.length > 160) errors.address = "Indiquez l'adresse (5 à 160 caractères).";
    else receive.address = address;
  }

  let rate = null;
  if (isChecked(checks.price)) {
    // Deux devises choisies dans la liste complète (codes ISO 4217), et le montant pour 100.
    const price = input.price && typeof input.price === "object" ? input.price : {};
    const symbol = text(price.symbol, 3).toUpperCase();
    const unit = text(price.unit, 3).toUpperCase();
    const amount = parseAmount(price.amount);
    if (!CURRENCY_CODES.has(symbol)) errors.price = "Prix sur 100 : choisissez la devise des 100 (€, $…).";
    else if (amount == null || amount <= 0 || amount >= 1e12) errors.price = "Prix sur 100 : indiquez le montant (ex. 65 000).";
    else if (!CURRENCY_CODES.has(unit)) errors.price = "Prix sur 100 : choisissez la devise du montant (ex. FCFA).";
    else rate = { symbol, amount, unit };
  }

  let feePercent = null;
  if (isChecked(checks.percent)) {
    const percent = parsePercent(input.percent); // « 25 », « 25% » ou « 25 % »
    if (percent == null || percent <= 0 || percent > 100) errors.percent = "Pourcentage : indiquez un nombre entre 0 et 100 (ex. 25).";
    else feePercent = percent;
  }
  return { receive, rate, feePercent, errors };
}

/**
 * @returns {Promise<{ok: true, account: object} | {ok: false, errors: Record<string, string>}>}
 */
export async function addAccount(mandataire, input, { user, ip, userAgent }) {
  const types = await accountTypeIds();
  const type = typeof input.type === "string" ? types.get(input.type) : null;
  const offer = readAccountOffer(input);
  const errors = { ...offer.errors };
  if (!type) errors.type = "Choisissez un compte de la liste.";
  const country = typeof input.country === "string" ? input.country.trim().toUpperCase() : "";
  if (!COUNTRY_CODES.has(country)) errors.country = "Choisissez le pays du compte.";
  const currency = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "";
  if (!CURRENCIES.has(currency)) errors.currency = "Choisissez la devise du compte.";
  const bank = input.type === "virement" && typeof input.bank === "string" ? input.bank.trim().slice(0, 150) : "";
  if (Object.keys(errors).length) return { ok: false, errors };

  const existing = await MandataireAccount.listPublic(mandataire.id);
  if (existing.length >= MAX_ACCOUNTS) return { ok: false, errors: { type: `Vous avez atteint le maximum de ${MAX_ACCOUNTS} comptes.` } };

  const id = await MandataireAccount.create({
    mandataireId: mandataire.id, typeId: type.id, country, currency, bank,
    receive: offer.receive, rate: offer.rate, feePercent: offer.feePercent,
  });
  await AuditLog.record({ actorUserId: user.id, actorRole: user.role, action: "account.create", entityType: "mandataire_account", entityId: id, metadata: { type: input.type, country }, ip, userAgent });
  return { ok: true, account: await MandataireAccount.findPublished(mandataire.id, id, { withReceive: true }) };
}

export async function removeAccount(mandataire, accountId, { user, ip, userAgent }) {
  const id = Number.parseInt(accountId, 10);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const removed = await MandataireAccount.remove(mandataire.id, id);
  if (removed) await AuditLog.record({ actorUserId: user.id, actorRole: user.role, action: "account.remove", entityType: "mandataire_account", entityId: id, ip, userAgent });
  return removed;
}

export const listAccounts = (mandataire) => MandataireAccount.listForOwner(mandataire.id);
