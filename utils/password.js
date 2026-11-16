/**
 * Mots de passe : hachage Argon2id et politique de robustesse.
 * Politique : 10 à 128 caractères, au moins une lettre et un chiffre, et une estimation de robustesse
 * (zxcvbn, dictionnaires français et courants) d'au moins 3 sur 4. Le pseudo, l'adresse e-mail et le nom
 * du site sont pénalisés s'ils apparaissent dans le mot de passe.
 */
import argon2 from "argon2";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as zxcvbnCommon from "@zxcvbn-ts/language-common";
import * as zxcvbnFr from "@zxcvbn-ts/language-fr";

const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 2 ** 16, // 64 Mo
  timeCost: 3,
  parallelism: 1,
});

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128; // borne haute : évite qu'un mot de passe géant ne monopolise le serveur
const MIN_SCORE = 3;

const zxcvbn = new ZxcvbnFactory({
  translations: zxcvbnFr.translations,
  graphs: zxcvbnCommon.adjacencyGraphs,
  dictionary: { ...zxcvbnCommon.dictionary, ...zxcvbnFr.dictionary },
});

/** Hache un mot de passe avec Argon2id. */
export const hashPassword = (password) => argon2.hash(password, ARGON2_OPTIONS);

/** Vérifie un mot de passe ; un hash illisible est traité comme un échec, jamais comme une erreur serveur. */
export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Le hash a-t-il été calculé avec d'anciens paramètres ? (il est alors recalculé à la connexion) */
export function needsRehash(hash) {
  try {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  } catch {
    return false;
  }
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
