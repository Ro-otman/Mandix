/**
 * Primitives cryptographiques partagées (module natif node:crypto uniquement).
 * Les jetons envoyés aux utilisateurs (liens e-mail, jeton de rafraîchissement) ne sont jamais stockés :
 * seule leur empreinte SHA-256 est enregistrée en base.
 */
import crypto from "node:crypto";

/** Jeton aléatoire imprévisible (256 bits par défaut), sûr dans une URL ou un cookie. */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

/** Empreinte SHA-256 en hexadécimal (64 caractères). */
export const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

/** Identifiant public non devinable (UUID v4). */
export const uuid = () => crypto.randomUUID();

/** Comparaison en temps constant de deux chaînes. */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Forme attendue d'un jeton reçu (évite toute requête en base pour une valeur fantaisiste). */
export const isTokenShape = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
