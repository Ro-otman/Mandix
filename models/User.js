/**
 * Comptes utilisateurs (table users). Requêtes préparées uniquement.
 * Les colonnes sensibles (password_hash) ne sortent de ce module que pour la vérification du mot de passe.
 */
import pool from "../config/database.js";

const PUBLIC_COLUMNS = `u.id, u.public_id, u.role, u.email, u.pseudo, u.first_name, u.last_name, u.status,
  u.email_verified_at, u.last_login_at, u.created_at`;

export const User = {
  /** Compte (avec le hash du mot de passe) pour la connexion. Les comptes supprimés sont ignorés. */
  async findForLogin(email) {
    const [rows] = await pool.execute(
      `SELECT ${PUBLIC_COLUMNS}, u.password_hash
         FROM users u
        WHERE u.email = ? AND u.deleted_at IS NULL
        LIMIT 1`,
      [email],
    );
    return rows[0] ?? null;
  },

  async findByEmail(email) {
    const [rows] = await pool.execute(
      `SELECT ${PUBLIC_COLUMNS} FROM users u WHERE u.email = ? AND u.deleted_at IS NULL LIMIT 1`,
      [email],
    );
    return rows[0] ?? null;
  },

  async findById(id, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT ${PUBLIC_COLUMNS} FROM users u WHERE u.id = ? AND u.deleted_at IS NULL LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** Pseudo déjà pris ? (comparaison insensible à la casse : collation utf8mb4_unicode_ci). */
  async pseudoExists(pseudo) {
    const [rows] = await pool.execute("SELECT 1 FROM users WHERE pseudo = ? LIMIT 1", [pseudo]);
    return rows.length > 0;
  },

  /** Crée un compte client ou mandataire en attente de confirmation de l'adresse e-mail. */
  async create({ publicId, role, email, pseudo, passwordHash }, connection = pool) {
    const [result] = await connection.execute(
      `INSERT INTO users (public_id, role, email, pseudo, password_hash, status, terms_accepted_at, privacy_accepted_at)
       VALUES (?, ?, ?, ?, ?, 'pending_email', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [publicId, role, email, pseudo, passwordHash],
    );
    return result.insertId;
  },

  /** Confirme l'adresse e-mail ; un compte en attente devient actif (un compte suspendu le reste). */
  async markEmailVerified(id, connection = pool) {
    await connection.execute(
      `UPDATE users
          SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()),
              status = IF(status = 'pending_email', 'active', status)
        WHERE id = ?`,
      [id],
    );
  },

  async updatePassword(id, passwordHash, connection = pool) {
    await connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, id]);
  },

  async recordLogin(id) {
    await pool.execute(
      `UPDATE users SET last_login_at = UTC_TIMESTAMP(), last_seen_at = UTC_TIMESTAMP(),
              failed_login_count = 0, locked_until = NULL
        WHERE id = ?`,
      [id],
    );
  },

  async recordFailedLogin(id, lockedUntil) {
    await pool.execute(
      "UPDATE users SET failed_login_count = failed_login_count + 1, locked_until = ? WHERE id = ?",
      [lockedUntil, id],
    );
  },
};
