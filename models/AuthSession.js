/**
 * Sessions de connexion et jetons de rafraîchissement (tables auth_sessions, auth_refresh_tokens).
 * Les dates d'expiration sont calculées par MySQL (UTC_TIMESTAMP) : aucune dépendance à l'horloge du serveur Node.
 */
import pool from "../config/database.js";

export const AuthSession = {
  async create({ publicId, userId, remember, userAgent, ip, ttlSeconds }, connection = pool) {
    const [result] = await connection.execute(
      `INSERT INTO auth_sessions (public_id, user_id, remember, user_agent, ip_address, expires_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP() + INTERVAL ? SECOND)`,
      [publicId, userId, remember ? 1 : 0, userAgent, ip, ttlSeconds],
    );
    return result.insertId;
  },

  /**
   * Session active + utilisateur, pour authentifier une requête porteuse d'un jeton d'accès.
   * Renvoie null si la session est révoquée, expirée, ou si le compte n'est plus utilisable.
   */
  async findActiveWithUser(publicId) {
    const [rows] = await pool.execute(
      `SELECT s.id AS session_id, s.public_id AS session_public_id, s.remember,
              u.id, u.public_id, u.role, u.email, u.pseudo, u.first_name, u.last_name, u.status, u.created_at,
              ap.admin_role
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN admin_profiles ap ON ap.user_id = u.id
        WHERE s.public_id = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > UTC_TIMESTAMP()
          AND u.deleted_at IS NULL
          AND u.status = 'active'
        LIMIT 1`,
      [publicId],
    );
    return rows[0] ?? null;
  },

  /** Jeton de rafraîchissement + état de sa session, verrouillé pour la durée de la transaction. */
  async findRefreshForUpdate(tokenHash, connection) {
    const [rows] = await connection.execute(
      `SELECT t.id, t.session_id, t.rotated_at,
              (t.expires_at > UTC_TIMESTAMP()) AS token_valid,
              TIMESTAMPDIFF(SECOND, t.rotated_at, UTC_TIMESTAMP()) AS rotated_seconds_ago,
              s.public_id AS session_public_id, s.user_id, s.remember,
              (s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP()) AS session_valid,
              TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), s.expires_at) AS session_seconds_left
         FROM auth_refresh_tokens t
         JOIN auth_sessions s ON s.id = t.session_id
        WHERE t.token_hash = ?
        LIMIT 1
          FOR UPDATE`,
      [tokenHash],
    );
    return rows[0] ?? null;
  },

  /** Nouveau jeton de rafraîchissement ; jamais au-delà de la fin absolue de la session. */
  async addRefreshToken({ sessionId, tokenHash, ttlSeconds }, connection = pool) {
    const [result] = await connection.execute(
      `INSERT INTO auth_refresh_tokens (session_id, token_hash, expires_at)
       SELECT ?, ?, LEAST(UTC_TIMESTAMP() + INTERVAL ? SECOND, s.expires_at)
         FROM auth_sessions s WHERE s.id = ?`,
      [sessionId, tokenHash, ttlSeconds, sessionId],
    );
    return result.insertId;
  },

  async markRotated(tokenId, replacedBy, connection) {
    await connection.execute(
      "UPDATE auth_refresh_tokens SET rotated_at = UTC_TIMESTAMP(), replaced_by = ? WHERE id = ?",
      [replacedBy, tokenId],
    );
  },

  async touch(sessionId, connection = pool) {
    await connection.execute("UPDATE auth_sessions SET last_used_at = UTC_TIMESTAMP() WHERE id = ?", [sessionId]);
  },

  async revoke(sessionId, reason, connection = pool) {
    await connection.execute(
      "UPDATE auth_sessions SET revoked_at = UTC_TIMESTAMP(), revoked_reason = ? WHERE id = ? AND revoked_at IS NULL",
      [reason, sessionId],
    );
  },

  async revokeByPublicId(publicId, reason) {
    await pool.execute(
      "UPDATE auth_sessions SET revoked_at = UTC_TIMESTAMP(), revoked_reason = ? WHERE public_id = ? AND revoked_at IS NULL",
      [reason, publicId],
    );
  },

  /** Révoque toutes les sessions d'un compte (réinitialisation du mot de passe, « déconnecter partout »). */
  async revokeAllForUser(userId, reason, connection = pool) {
    const [result] = await connection.execute(
      "UPDATE auth_sessions SET revoked_at = UTC_TIMESTAMP(), revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL",
      [reason, userId],
    );
    return result.affectedRows;
  },

  /** Ménage : jetons expirés, puis sessions terminées depuis plus de 30 jours (gardées un temps pour l'audit). */
  async purgeExpired() {
    const [tokens] = await pool.execute("DELETE FROM auth_refresh_tokens WHERE expires_at < UTC_TIMESTAMP() - INTERVAL 1 DAY");
    const [sessions] = await pool.execute(
      `DELETE FROM auth_sessions
        WHERE (expires_at < UTC_TIMESTAMP() - INTERVAL 30 DAY)
           OR (revoked_at IS NOT NULL AND revoked_at < UTC_TIMESTAMP() - INTERVAL 30 DAY)`,
    );
    return { tokens: tokens.affectedRows, sessions: sessions.affectedRows };
  },
};
