/**
 * Chiffrement des données sensibles au repos : AES-256-GCM (confidentialité + intégrité).
 * Utilisé pour les messages de la messagerie, les coordonnées de réception (IBAN, e-mail PayPal, adresse de
 * portefeuille…) et les fichiers joints (preuves, captures).
 *
 * Format binaire : version (1 octet) | IV (12 octets) | étiquette d'authentification (16 octets) | texte chiffré.
 * La clé (32 octets) est dans .env (DATA_ENCRYPTION_KEY, base64), jamais dans le code ni en base.
 * Un « contexte » (ex. « event:42 ») est lié au chiffrement (données associées) : un contenu chiffré copié
 * vers une autre ligne ne se déchiffre pas.
 */
import crypto from "node:crypto";
import config from "../config/app.js";

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const key = Buffer.from(config.dataEncryptionKey, "base64");
if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY doit faire 32 octets (base64) : voir .env.example.");

/** Chiffre un Buffer. */
export function encryptBuffer(plain, context = "") {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  if (context) cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

/** Déchiffre un Buffer produit par encryptBuffer ; lève une erreur si le contenu a été modifié. */
export function decryptBuffer(blob, context = "") {
  const data = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (data.length < 1 + IV_BYTES + TAG_BYTES || data[0] !== VERSION) throw new Error("Contenu chiffré illisible.");
  const iv = data.subarray(1, 1 + IV_BYTES);
  const tag = data.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  if (context) decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]);
}

export const encryptText = (text, context) => encryptBuffer(Buffer.from(String(text), "utf8"), context);
export const decryptText = (blob, context) => decryptBuffer(blob, context).toString("utf8");
export const encryptJson = (value, context) => encryptText(JSON.stringify(value ?? {}), context);
export const decryptJson = (blob, context) => JSON.parse(decryptText(blob, context));
