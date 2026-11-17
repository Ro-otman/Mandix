/**
 * Suggestions : les clients et les mandataires indiquent ce que l'équipe Mandix devrait améliorer ou modifier
 * sur le site. Elles ne sont visibles que par l'équipe (espace administrateur, « Suggestions ») : la page des
 * espaces client et mandataire ne présente que le formulaire, jamais la liste.
 */
import pool from "../config/database.js";
import { AuditLog } from "../models/Security.js";
import { pushAdminBadges } from "./badgeService.js";

/** Sujets proposés dans le formulaire (clé enregistrée, libellé). */
export const SUGGESTION_TOPICS = Object.freeze([
  ["feature", "Nouvelle fonctionnalité"],
  ["design", "Design et facilité d'utilisation"],
  ["problem", "Problème rencontré"],
  ["other", "Autre"],
]);
export const topicLabel = (key) => SUGGESTION_TOPICS.find(([k]) => k === key)?.[1] ?? "Autre";

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 2000;
/** Au plus 10 suggestions par compte et par 24 heures (contre les envois en rafale). */
const DAILY_LIMIT = 10;

/** Suivi par l'équipe : nouvelle → lue → traitée. */
export const SUGGESTION_STATUSES = Object.freeze({ new: "Nouvelle", read: "Lue", done: "Traitée" });

/**
 * Enregistre une suggestion. Les données du navigateur sont revérifiées : sujet parmi la liste, texte de 10 à
 * 2 000 caractères (affiché échappé dans l'administration).
 * @returns {Promise<{ok: true} | {ok: false, errors: object, values: object}>}
 */
export async function submit(user, input, { ip = null, userAgent = null } = {}) {
  const topic = SUGGESTION_TOPICS.some(([k]) => k === input?.topic) ? input.topic : "";
  const message = typeof input?.message === "string" ? input.message.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : "";
  const values = { topic, message: message.slice(0, MESSAGE_MAX) };
  const errors = {};
  if (!topic) errors.topic = "Choisissez un sujet.";
  if (message.length < MESSAGE_MIN) errors.message = `Décrivez votre suggestion en quelques mots (${MESSAGE_MIN} caractères minimum).`;
  else if (message.length > MESSAGE_MAX) errors.message = `${MESSAGE_MAX} caractères maximum.`;
  if (Object.keys(errors).length) return { ok: false, errors, values };

  const [[recent]] = await pool.execute(
    "SELECT COUNT(*) AS n FROM suggestions WHERE user_id = ? AND created_at > UTC_TIMESTAMP() - INTERVAL 1 DAY",
    [user.id],
  );
  if (Number(recent.n) >= DAILY_LIMIT) {
    return { ok: false, errors: { message: "Vous avez déjà envoyé beaucoup de suggestions aujourd'hui. Merci ! Réessayez demain." }, values };
  }

  const [result] = await pool.execute(
    "INSERT INTO suggestions (user_id, author_role, topic, message) VALUES (?, ?, ?, ?)",
    [user.id, user.role, topic, message],
  );
  await AuditLog.record({ actorUserId: user.id, actorRole: user.role, action: "suggestion.create", entityType: "suggestion", entityId: result.insertId, ip, userAgent });
  await pushAdminBadges(); // compteur « Suggestions » de l'équipe, en direct
  return { ok: true };
}

/** Suggestions pour l'équipe, les plus récentes d'abord. statut : "new" | "read" | "done" | "" (toutes). */
export async function list({ statut = "" } = {}) {
  const where = Object.hasOwn(SUGGESTION_STATUSES, statut) ? "WHERE s.status = ?" : "";
  const [rows] = await pool.execute(
    `SELECT s.id, s.author_role, s.topic, s.message, s.status, s.created_at, s.read_at,
            u.pseudo, u.email, u.deleted_at, mp.slug
       FROM suggestions s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN mandataire_profiles mp ON mp.user_id = u.id
       ${where}
      ORDER BY s.status = 'new' DESC, s.created_at DESC
      LIMIT 200`,
    where ? [statut] : [],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    role: r.author_role,
    topic: r.topic,
    topicLabel: topicLabel(r.topic),
    message: r.message,
    status: r.status,
    createdAt: r.created_at,
    author: r.pseudo && !r.deleted_at ? r.pseudo : "Compte supprimé",
    email: r.deleted_at ? null : r.email,
    slug: r.author_role === "mandataire" && !r.deleted_at ? r.slug : null,
  }));
}

/** Nombre de suggestions par statut (onglets de l'administration). */
export async function counts() {
  const [rows] = await pool.execute("SELECT status, COUNT(*) AS n FROM suggestions GROUP BY status");
  const result = { new: 0, read: 0, done: 0, all: 0 };
  for (const r of rows) { result[r.status] = Number(r.n); result.all += Number(r.n); }
  return result;
}

/** L'équipe marque une suggestion comme lue, traitée, ou de nouveau à lire. */
export async function setStatus(admin, id, status, { ip = null, userAgent = null } = {}) {
  if (!Object.hasOwn(SUGGESTION_STATUSES, status) || !/^\d{1,18}$/.test(String(id))) return { ok: false, error: "Action inconnue." };
  const [result] = await pool.execute(
    "UPDATE suggestions SET status = ?, read_at = CASE WHEN ? = 'new' THEN NULL ELSE COALESCE(read_at, UTC_TIMESTAMP()) END WHERE id = ?",
    [status, status, Number(id)],
  );
  if (!result.affectedRows) return { ok: false, error: "Suggestion introuvable." };
  await AuditLog.record({ actorUserId: admin.id, actorRole: "admin", action: `suggestion.${status}`, entityType: "suggestion", entityId: Number(id), ip, userAgent });
  await pushAdminBadges();
  return { ok: true };
}
