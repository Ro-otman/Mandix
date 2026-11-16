/**
 * Traces de sécurité : tentatives de connexion (login_attempts) et journal d'audit (audit_logs, en ajout seul).
 * Jamais de mot de passe, de jeton ni de coordonnées dans ces tables.
 */
import pool from "../config/database.js";

const clip = (value, max) => (value == null ? null : String(value).slice(0, max));

export const LoginAttempt = {
  async record({ email, userId = null, ip, userAgent, succeeded }) {
    await pool.execute(
      "INSERT INTO login_attempts (email, user_id, ip_address, user_agent, succeeded) VALUES (?, ?, ?, ?, ?)",
      [clip(email, 191), userId, clip(ip, 45) || "inconnue", clip(userAgent, 255), succeeded ? 1 : 0],
    );
  },

  /** Échecs récents pour une adresse (qu'un compte existe ou non : même comportement dans les deux cas). */
  async recentFailures(email, windowSeconds) {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS n FROM login_attempts
        WHERE email = ? AND succeeded = 0 AND created_at > UTC_TIMESTAMP() - INTERVAL ? SECOND`,
      [clip(email, 191), windowSeconds],
    );
    return Number(rows[0]?.n || 0);
  },

  async purgeOld() {
    const [result] = await pool.execute("DELETE FROM login_attempts WHERE created_at < UTC_TIMESTAMP() - INTERVAL 90 DAY");
    return result.affectedRows;
  },
};

export const AuditLog = {
  async record({ actorUserId = null, actorRole = null, action, entityType = null, entityId = null, metadata = null, ip = null, userAgent = null }, connection = pool) {
    await connection.execute(
      `INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, metadata, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [actorUserId, actorRole, action, entityType, entityId, metadata ? JSON.stringify(metadata) : null, clip(ip, 45), clip(userAgent, 255)],
    );
  },
};
