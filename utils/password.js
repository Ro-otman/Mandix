/**
 * Mots de passe : hachage Argon2id et politique de robustesse.
 * Argon2id calculé par hash-wasm (WebAssembly) : aucun module natif à compiler, il fonctionne sur tout serveur
 * quelle que soit sa version de glibc (le module natif « argon2 » exigeait GLIBC 2.34, absente chez l'hébergeur).
 * Format PHC standard ($argon2id$v=19$m=…,t=…,p=…$sel$hash) : les mots de passe déjà enregistrés restent valides.
 * Politique : 10 à 128 caractères, au moins une lettre et un chiffre, et une estimation de robustesse
 * (zxcvbn, dictionnaires français et courants) d'au moins 3 sur 4. Le pseudo, l'adresse e-mail et le nom
 * du site sont pénalisés s'ils apparaissent dans le mot de passe.
 */
import { randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as zxcvbnCommon from "@zxcvbn-ts/language-common";
import * as zxcvbnFr from "@zxcvbn-ts/language-fr";

const ARGON2_OPTIONS = Object.freeze({
  memorySize: 2 ** 16, // 64 Mo (en Kio)
  iterations: 3,
  parallelism: 1,
  hashLength: 32,
  saltLength: 16,
});

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128; // borne haute : évite qu'un mot de passe géant ne monopolise le serveur
const MIN_SCORE = 3;

const zxcvbn = new ZxcvbnFactory({
  translations: zxcvbnFr.translations,
  graphs: zxcvbnCommon.adjacencyGraphs,
  dictionary: { ...zxcvbnCommon.dictionary, ...zxcvbnFr.dictionary },
});

/** Hache un mot de passe avec Argon2id (sel aléatoire de 16 octets, résultat au format PHC). */
export const hashPassword = (password) =>
  argon2id({
    password,
    salt: randomBytes(ARGON2_OPTIONS.saltLength),
    parallelism: ARGON2_OPTIONS.parallelism,
    iterations: ARGON2_OPTIONS.iterations,
    memorySize: ARGON2_OPTIONS.memorySize,
    hashLength: ARGON2_OPTIONS.hashLength,
    outputType: "encoded",
  });

/** Vérifie un mot de passe ; un hash illisible est traité comme un échec, jamais comme une erreur serveur. */
export async function verifyPassword(hash, password) {
  if (typeof hash !== "string" || !hash.startsWith("$argon2") || typeof password !== "string") return false;
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}

/** Le hash a-t-il été calculé avec d'autres paramètres ? (il est alors recalculé à la connexion) */
export function needsRehash(hash) {
  const match = /^\$argon2(id|i|d)\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(String(hash));
  if (!match) return false; // format inconnu : pas de recalcul automatique
  const [, variant, version, m, t, p] = match;
  return variant !== "id" || Number(version) !== 19 || Number(m) !== ARGON2_OPTIONS.memorySize
    || Number(t) !== ARGON2_OPTIONS.iterations || Number(p) !== ARGON2_OPTIONS.parallelism;
}

/**
 * Contrôle la robustesse d'un nouveau mot de passe.
 * @returns {string|null} message d'erreur à afficher, ou null si le mot de passe est accepté
 */
export function checkPasswordPolicy(password, { pseudo = "", email = "" } = {}) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    return `Le mot de passe doit contenir au moins ${PASSWORD_MIN} caractères.`;
  }
  if (password.length > PASSWORD_MAX) return `Le mot de passe ne doit pas dépasser ${PASSWORD_MAX} caractères.`;
  if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) {
    return "Le mot de passe doit contenir au moins une lettre et un chiffre.";
  }
  const userInputs = ["mandix", pseudo, email, email.split("@")[0]].filter((v) => v && v.length >= 3).map((v) => v.toLowerCase());
  const result = zxcvbn.check(password, userInputs);
  if (result.score < MIN_SCORE) {
    const hint = result.feedback.warning || result.feedback.suggestions?.[0];
    return `Mot de passe trop facile à deviner.${hint ? ` ${hint}` : ""} Allongez-le ou mélangez des mots et des caractères variés.`;
  }
  return null;
}
