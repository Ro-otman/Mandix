/**
 * Jetons à usage unique envoyés par e-mail (table user_tokens) : confirmation de l'adresse et
 * réinitialisation du mot de passe. Seul le hash SHA-256 est stocké.
 */
import pool from "../config/database.js";

export const PURPOSES = Object.freeze({ EMAIL: "email_verification", RESET: "password_reset" });

export const UserToken = {
  /** Crée un jeton après avoir invalidé les précédents du même usage (un seul lien valable à la fois). */
  async issue({ userId, purpose, tokenHash, ttlSeconds }, connection = pool) {
    await connection.execute(
      "UPDATE user_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND purpose = ? AND used_at IS NULL",
      [userId, purpose],
    );
    await connection.execute(
      `INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at)
       VALUES (?, ?, ?, UTC_TIMESTAMP() + INTERVAL ? SECOND)`,
      [userId, purpose, tokenHash, ttlSeconds],
    );
  },

  /** Jeton valide (non utilisé, non expiré) ; verrouillé si une connexion de transaction est fournie. */
  async findValid(tokenHash, purpose, connection = pool, { lock = false } = {}) {
    const [rows] = await connection.execute(
      `SELECT id, user_id FROM user_tokens
        WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
        LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [tokenHash, purpose],
    );
    return rows[0] ?? null;
  },

  /** Jeton déjà utilisé ou expiré : permet d'afficher « adresse déjà confirmée » plutôt qu'une erreur. */
  async findAny(tokenHash, purpose) {
    const [rows] = await pool.execute(
      `SELECT t.user_id, t.used_at, (t.expires_at > UTC_TIMESTAMP()) AS not_expired, u.email_verified_at
         FROM user_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ? AND t.purpose = ?
        LIMIT 1`,
      [tokenHash, purpose],
    );
    return rows[0] ?? null;
  },

  async consume(id, connection = pool) {
    const [result] = await connection.execute(
      "UPDATE user_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ? AND used_at IS NULL",
      [id],
    );
    return result.affectedRows === 1;
  },

  async consumeAllForUser(userId, purpose, connection = pool) {
    await connection.execute(
      "UPDATE user_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND purpose = ? AND used_at IS NULL",
      [userId, purpose],
    );
  },

  /** Nombre de liens envoyés récemment (limite anti-abus : délai entre deux envois, plafond quotidien). */
  async recentCounts(userId, purpose) {
    const [rows] = await pool.execute(
      `SELECT SUM(created_at > UTC_TIMESTAMP() - INTERVAL 60 SECOND) AS last_minute,
              SUM(created_at > UTC_TIMESTAMP() - INTERVAL 1 DAY) AS last_day
         FROM user_tokens WHERE user_id = ? AND purpose = ?`,
      [userId, purpose],
    );
    return { lastMinute: Number(rows[0]?.last_minute || 0), lastDay: Number(rows[0]?.last_day || 0) };
  },

  async purgeExpired() {
    const [result] = await pool.execute("DELETE FROM user_tokens WHERE expires_at < UTC_TIMESTAMP() - INTERVAL 7 DAY");
    return result.affectedRows;
  },
};
