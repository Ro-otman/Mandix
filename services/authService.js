/**
 * Logique de l'authentification : inscription, confirmation de l'adresse e-mail, connexion, déconnexion,
 * mot de passe oublié et réinitialisation.
 *
 * Principes appliqués :
 *  - Aucune réponse ne révèle si une adresse e-mail possède un compte (inscription, mot de passe oublié,
 *    renvoi du lien) : même message, même durée de traitement ; le titulaire est prévenu par e-mail.
 *  - Verrouillage progressif : 5 échecs en 15 minutes sur une même adresse bloquent les essais 15 minutes,
 *    que le compte existe ou non (en plus de la limite par adresse IP de middlewares/rateLimiter.js).
 *  - Jetons e-mail à usage unique, hachés en base, durée courte ; un seul lien valable à la fois.
 *  - Réinitialisation du mot de passe : toutes les sessions du compte sont fermées.
 */
import config from "../config/app.js";
import { withTransaction } from "../config/database.js";
import { User } from "../models/User.js";
import { UserToken, PURPOSES } from "../models/UserToken.js";
import { AuthSession } from "../models/AuthSession.js";
import { LoginAttempt, AuditLog } from "../models/Security.js";
import { MandataireProfile } from "../models/MandataireProfile.js";
import { hashPassword, verifyPassword, needsRehash, checkPasswordPolicy } from "../utils/password.js";
import { randomToken, sha256, uuid, isTokenShape } from "../utils/crypto.js";
import { openSession } from "./tokenService.js";
import * as mail from "./mailService.js";

export const LOCK = Object.freeze({ maxFailures: 5, windowSeconds: 15 * 60 });
const RESEND = Object.freeze({ perDay: 5 }); // et pas plus d'un envoi par minute

const logMailError = (error) => console.error("[e-mail] échec de l'envoi :", error.message);
/** Envoi en arrière-plan : la réponse ne dépend ni de la durée ni du succès de l'envoi (pas d'indice exploitable). */
const sendLater = (promise) => { promise.catch(logMailError); };

// Hash factice : quand l'adresse est inconnue, on vérifie quand même un mot de passe (durée identique).
let dummyHashPromise = null;
const dummyHash = () => (dummyHashPromise ??= hashPassword(randomToken(24)));

/* ------------------------------------------------------------------ Inscription */

/**
 * @param {{role: 'client'|'mandataire', pseudo: string, email: string, password: string}} input  (déjà validé)
 * @returns {Promise<{ok: true} | {ok: false, errors: Record<string, string>}>}
 */
export async function register({ role, pseudo, email, password }, { ip, userAgent }) {
  const passwordError = checkPasswordPolicy(password, { pseudo, email });
  if (passwordError) return { ok: false, errors: { password: passwordError } };
  if (await User.pseudoExists(pseudo)) {
    return { ok: false, errors: { pseudo: "Ce pseudo est déjà pris. Choisissez-en un autre." } };
  }

  // Hachage avant le contrôle de l'adresse : même durée de traitement qu'elle soit libre ou non.
  const passwordHash = await hashPassword(password);
  const existing = await User.findByEmail(email);
  if (existing) {
    if (existing.status === "pending_email") await issueVerification(existing);
    else sendLater(mail.sendAccountExistsEmail(existing, role));
    return { ok: true };
  }

  const token = randomToken(32);
  try {
    await withTransaction(async (connection) => {
      const userId = await User.create({ publicId: uuid(), role, email, pseudo, passwordHash }, connection);
      if (role === "mandataire") await MandataireProfile.createForUser(userId, pseudo, connection);
      await UserToken.issue(
        { userId, purpose: PURPOSES.EMAIL, tokenHash: sha256(token), ttlSeconds: config.tokens.emailVerificationTtlSeconds },
        connection,
      );
      await AuditLog.record({ actorUserId: userId, actorRole: role, action: "auth.register", entityType: "user", entityId: userId, ip, userAgent }, connection);
    });
  } catch (error) {
    // Deux inscriptions simultanées avec le même pseudo ou la même adresse.
    if (error.code === "ER_DUP_ENTRY") {
      if (String(error.message).includes("pseudo")) {
        return { ok: false, errors: { pseudo: "Ce pseudo est déjà pris. Choisissez-en un autre." } };
      }
      return { ok: true };
    }
    throw error;
  }
  sendLater(mail.sendVerificationEmail({ email, pseudo, role }, token));
  return { ok: true };
}

/** Nouveau lien de confirmation (un par minute, cinq par jour au maximum). */
async function issueVerification(user) {
  const counts = await UserToken.recentCounts(user.id, PURPOSES.EMAIL);
  if (counts.lastMinute > 0 || counts.lastDay >= RESEND.perDay) return;
  const token = randomToken(32);
  await UserToken.issue({ userId: user.id, purpose: PURPOSES.EMAIL, tokenHash: sha256(token), ttlSeconds: config.tokens.emailVerificationTtlSeconds });
  sendLater(mail.sendVerificationEmail(user, token));
}

/** « Renvoyer l'e-mail » : réponse identique qu'un compte en attente existe ou non. */
export async function resendVerification(email) {
  const user = await User.findByEmail(email);
  if (user?.status === "pending_email") await issueVerification(user);
}

/* ------------------------------------------------------------------ Confirmation de l'adresse e-mail */

/** @returns {Promise<{ok: true, already?: boolean, role: string|null} | {ok: false}>} (role : onglet de connexion à proposer) */
export async function verifyEmail(token, { ip, userAgent }) {
  if (!isTokenShape(token)) return { ok: false };
  const tokenHash = sha256(token);
  const verifiedUserId = await withTransaction(async (connection) => {
    const row = await UserToken.findValid(tokenHash, PURPOSES.EMAIL, connection, { lock: true });
    if (!row) return null;
    await UserToken.consume(row.id, connection);
    await User.markEmailVerified(row.user_id, connection);
    await AuditLog.record({ actorUserId: row.user_id, action: "auth.email_verified", entityType: "user", entityId: row.user_id, ip, userAgent }, connection);
    return row.user_id;
  });
  const roleOf = async (userId) => (await User.findById(userId))?.role ?? null;
  if (verifiedUserId) return { ok: true, role: await roleOf(verifiedUserId) };
  // Lien déjà utilisé (double clic, ou analyse automatique du lien par la messagerie) sur une adresse confirmée.
  const previous = await UserToken.findAny(tokenHash, PURPOSES.EMAIL);
  if (previous?.used_at && previous.email_verified_at) return { ok: true, already: true, role: await roleOf(previous.user_id) };
  return { ok: false };
}

/* ------------------------------------------------------------------ Connexion */

const INVALID = { ok: false, code: "invalid", message: "Adresse e-mail ou mot de passe incorrect." };

/**
 * @returns {Promise<{ok: true, user: object, tokens: object} | {ok: false, code: string, message: string}>}
 */
/** Onglet de connexion : « client » ou « mandataire ». Les administrateurs se connectent depuis l'un ou l'autre. */
const SPACE_ROLES = Object.freeze({ client: ["client", "admin"], mandataire: ["mandataire", "admin"] });
const WRONG_SPACE = Object.freeze({
  client: "Ce compte est un compte client. Connectez-vous depuis l'onglet « Client ».",
  mandataire: "Ce compte est un compte mandataire. Connectez-vous depuis l'onglet « Professionnel ».",
});

/**
 * @param space onglet choisi ("client" | "mandataire") : un compte d'un autre type est refusé, sans ouvrir
 *              de session. Absent : pas de contrôle (le formulaire l'envoie toujours).
 */
export async function login({ email, password, remember, space = null }, { ip, userAgent }) {
  const failures = await LoginAttempt.recentFailures(email, LOCK.windowSeconds);
  if (failures >= LOCK.maxFailures) {
    return { ok: false, code: "locked", message: "Trop de tentatives pour cette adresse. Réessayez dans 15 minutes ou réinitialisez votre mot de passe." };
  }

  const user = await User.findForLogin(email);
  const passwordOk = user ? await verifyPassword(user.password_hash, password) : (await verifyPassword(await dummyHash(), password), false);

  if (!user || !passwordOk) {
    await LoginAttempt.record({ email, userId: user?.id ?? null, ip, userAgent, succeeded: false });
    if (user) {
      const lockedUntil = failures + 1 >= LOCK.maxFailures ? new Date(Date.now() + LOCK.windowSeconds * 1000) : null;
      await User.recordFailedLogin(user.id, lockedUntil);
    }
    return INVALID;
  }

  // Mot de passe correct : on peut expliquer précisément pourquoi la connexion est refusée.
  if (user.status === "pending_email") {
    return { ok: false, code: "unverified", message: "Confirmez d'abord votre adresse e-mail : cliquez sur le lien que nous vous avons envoyé." };
  }
  if (user.status === "suspended") {
    return { ok: false, code: "suspended", message: "Votre compte est suspendu. Contactez l'équipe depuis le centre d'aide." };
  }
  if (user.status !== "active") return INVALID;
  // Mauvais onglet : le mot de passe est correct (pas un échec de connexion), mais aucune session n'est ouverte.
  if (SPACE_ROLES[space] && !SPACE_ROLES[space].includes(user.role)) {
    return { ok: false, code: "wrong_space", message: WRONG_SPACE[user.role] };
  }

  if (needsRehash(user.password_hash)) await User.updatePassword(user.id, await hashPassword(password));

  const tokens = await openSession(user, { remember: Boolean(remember), userAgent, ip });
  await Promise.all([
    User.recordLogin(user.id),
    LoginAttempt.record({ email, userId: user.id, ip, userAgent, succeeded: true }),
    AuditLog.record({ actorUserId: user.id, actorRole: user.role, action: "auth.login", entityType: "user", entityId: user.id, metadata: { remember: Boolean(remember) }, ip, userAgent }),
  ]);
  delete user.password_hash;
  return { ok: true, user, tokens };
}

/* ------------------------------------------------------------------ Déconnexion */

export async function logout(auth, user, { ip, userAgent }) {
  if (!auth?.sessionId) return;
  await AuthSession.revoke(auth.sessionId, "logout");
  await AuditLog.record({ actorUserId: user?.id ?? null, actorRole: user?.role ?? null, action: "auth.logout", entityType: "auth_session", entityId: auth.sessionId, ip, userAgent });
}

/** Ferme toutes les sessions du compte (tous les appareils). */
export async function logoutEverywhere(user, { ip, userAgent }) {
  const closed = await AuthSession.revokeAllForUser(user.id, "logout_all");
  await AuditLog.record({ actorUserId: user.id, actorRole: user.role, action: "auth.logout_all", entityType: "user", entityId: user.id, metadata: { sessions: closed }, ip, userAgent });
  return closed;
}

/* ------------------------------------------------------------------ Mot de passe oublié */

/** Réponse identique qu'un compte existe ou non ; un lien par minute, cinq par jour au maximum. */
export async function requestPasswordReset(email) {
  const user = await User.findByEmail(email);
  if (!user || !["active", "pending_email"].includes(user.status)) return;
  const counts = await UserToken.recentCounts(user.id, PURPOSES.RESET);
  if (counts.lastMinute > 0 || counts.lastDay >= RESEND.perDay) return;
  const token = randomToken(32);
  await UserToken.issue({ userId: user.id, purpose: PURPOSES.RESET, tokenHash: sha256(token), ttlSeconds: config.tokens.passwordResetTtlSeconds });
  sendLater(mail.sendPasswordResetEmail(user, token));
}

/** Le lien de réinitialisation est-il encore valable ? (affichage du formulaire) */
export async function isResetTokenValid(token) {
  if (!isTokenShape(token)) return false;
  return Boolean(await UserToken.findValid(sha256(token), PURPOSES.RESET));
}

/**
 * @returns {Promise<{ok: true} | {ok: false, code: 'invalid'} | {ok: false, errors: Record<string, string>}>}
 */
export async function resetPassword(token, password, { ip, userAgent }) {
  if (!isTokenShape(token)) return { ok: false, code: "invalid" };
  const tokenHash = sha256(token);
  const pending = await UserToken.findValid(tokenHash, PURPOSES.RESET);
  if (!pending) return { ok: false, code: "invalid" };
  const user = await User.findById(pending.user_id);
  if (!user) return { ok: false, code: "invalid" };

  const passwordError = checkPasswordPolicy(password, { pseudo: user.pseudo ?? "", email: user.email });
  if (passwordError) return { ok: false, errors: { password: passwordError } };
  const passwordHash = await hashPassword(password);

  const done = await withTransaction(async (connection) => {
    const row = await UserToken.findValid(tokenHash, PURPOSES.RESET, connection, { lock: true });
    if (!row) return false; // lien utilisé entre-temps
    await UserToken.consumeAllForUser(row.user_id, PURPOSES.RESET, connection);
    await User.updatePassword(row.user_id, passwordHash, connection);
    await User.markEmailVerified(row.user_id, connection); // le lien reçu prouve la possession de l'adresse
    await AuthSession.revokeAllForUser(row.user_id, "password_reset", connection);
    await AuditLog.record({ actorUserId: row.user_id, actorRole: user.role, action: "auth.password_reset", entityType: "user", entityId: row.user_id, ip, userAgent }, connection);
    return true;
  });
  if (!done) return { ok: false, code: "invalid" };
  sendLater(mail.sendPasswordChangedEmail(user, { userAgent }));
  return { ok: true, role: user.role };
}

/* ------------------------------------------------------------------ Ménage périodique */

export async function purgeExpiredSecurityData() {
  const [sessions, tokens, attempts] = await Promise.all([
    AuthSession.purgeExpired(),
    UserToken.purgeExpired(),
    LoginAttempt.purgeOld(),
  ]);
  return { ...sessions, emailTokens: tokens, loginAttempts: attempts };
}
