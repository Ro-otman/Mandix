/**
 * Compte de l'utilisateur connecté : pseudo, mot de passe, suppression (anonymisation), profil du mandataire.
 * Entrées revalidées ici ; actions sensibles tracées dans le journal d'audit.
 */
import pool, { withTransaction } from "../config/database.js";
import { User } from "../models/User.js";
import { AuthSession } from "../models/AuthSession.js";
import { AuditLog } from "../models/Security.js";
import { COUNTRIES } from "../content/countries.js";
import { hashPassword, verifyPassword, checkPasswordPolicy, PASSWORD_MAX } from "../utils/password.js";
import { randomToken } from "../utils/crypto.js";

const PSEUDO = /^[A-Za-z0-9._-]{3,20}$/;
const COUNTRY_CODES = new Set(COUNTRIES.map((c) => c.code));

/** @returns {Promise<{ok: true} | {ok: false, error: string}>} */
export async function changePseudo(user, value, ctx) {
  const pseudo = typeof value === "string" ? value.trim() : "";
  if (!PSEUDO.test(pseudo)) return { ok: false, error: "Pseudo : 3 à 20 caractères (lettres, chiffres, point, tiret, tiret bas)." };
  if (pseudo === user.pseudo) return { ok: true };
  const [[taken]] = await pool.execute("SELECT COUNT(*) AS n FROM users WHERE pseudo = ? AND id <> ?", [pseudo, user.id]);
  if (Number(taken.n)) return { ok: false, error: "Ce pseudo est déjà pris. Choisissez-en un autre." };
  await pool.execute("UPDATE users SET pseudo = ? WHERE id = ?", [pseudo, user.id]);
  await AuditLog.record({ actorUserId: user.id, actorRole: user.role, action: "user.pseudo_change", entityType: "user", entityId: user.id, ...ctx });
  return { ok: true };
}

/** Change le mot de passe ; toutes les autres sessions sont fermées (la session courante reste ouverte). */
export async function changePassword(user, auth, { current, password, passwordConfirm }, ctx) {
  if (typeof current !== "string" || !current || current.length > PASSWORD_MAX) return { ok: false, error: "Indiquez votre mot de passe actuel." };
  if (password !== passwordConfirm) return { ok: false, error: "Les deux nouveaux mots de passe ne correspondent pas." };
  const account = await User.findForLogin(user.email);
  if (!account || !(await verifyPassword(account.password_hash, current))) return { ok: false, error: "Mot de passe actuel incorrect." };
  const policy = checkPasswordPolicy(password, { pseudo: user.pseudo ?? "", email: user.email });
  if (policy) return { ok: false, error: policy };
  const hash = await hashPassword(password);
  await withTransaction(async (connection) => {
    await User.updatePassword(user.id, hash, connection);
    await connection.execute(
      "UPDATE auth_sessions SET revoked_at = UTC_TIMESTAMP(), revoked_reason = 'logout_all' WHERE user_id = ? AND revoked_at IS NULL AND id <> ?",
      [user.id, auth?.sessionId ?? 0],
    );
    await AuditLog.record({ actorUserId: user.id, actorRole: user.role, action: "user.password_change", entityType: "user", entityId: user.id, ...ctx }, connection);
  });
  return { ok: true };
}

/**
 * Suppression du compte : données personnelles anonymisées (e-mail, pseudo, mot de passe), sessions fermées,
 * comptes de paiement retirés. L'historique des transactions reste, de façon anonyme.
 */
export async function deleteAccount(user, ctx) {
  await withTransaction(async (connection) => {
    const [[open]] = await connection.execute(
      `SELECT COUNT(*) AS n FROM transactions WHERE (client_id = ? OR mandataire_id = (SELECT id FROM mandataire_profiles WHERE user_id = ?))
         AND status NOT IN ('completed','cancelled')`,
      [user.id, user.id],
    );
    if (Number(open.n)) throw Object.assign(new Error("open"), { code: "OPEN_TRANSACTION" });
    await connection.execute(
      `UPDATE users SET email = ?, pseudo = ?, password_hash = ?, status = 'deactivated', deleted_at = UTC_TIMESTAMP() WHERE id = ?`,
      [`supprime-${user.id}@compte-supprime.invalid`, `supprime-${user.id}`, await hashPassword(randomToken(24)), user.id],
    );
    await connection.execute(
      "UPDATE mandataire_accounts SET status = 'removed', removed_at = UTC_TIMESTAMP() WHERE status = 'published' AND mandataire_id = (SELECT id FROM mandataire_profiles WHERE user_id = ?)",
      [user.id],
    );
    await AuthSession.revokeAllForUser(user.id, "logout_all", connection);
    await AuditLog.record({ actorUserId: user.id, actorRole: user.role, action: "user.delete", entityType: "user", entityId: user.id, ...ctx }, connection);
  });
}

/** Profil public du mandataire : présentation, pays (facultatif), langues. */
export async function updateMandataireProfile(mandataire, user, input, ctx) {
  const bio = typeof input.bio === "string" ? input.bio.trim().slice(0, 1200) : "";
  const country = typeof input.country === "string" && COUNTRY_CODES.has(input.country) ? input.country : null;
  const languages = typeof input.languages === "string"
    ? [...new Set(input.languages.split(",").map((l) => l.trim().replace(/\s+/g, " ")).filter((l) => /^[\p{L} '-]{2,30}$/u.test(l)))].slice(0, 8)
    : [];
  await pool.execute("UPDATE mandataire_profiles SET bio = ?, country_code = ?, languages = ? WHERE id = ?", [bio || null, country, JSON.stringify(languages), mandataire.id]);
  await AuditLog.record({ actorUserId: user.id, actorRole: user.role, action: "mandataire.profile_update", entityType: "mandataire_profile", entityId: mandataire.id, ...ctx });
  return { ok: true };
}
