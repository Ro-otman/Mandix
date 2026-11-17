/**
 * Pool MySQL (mysql2/promise).
 * Toujours utiliser pool.execute(sql, params) : requêtes préparées, jamais de concaténation.
 * Les dates sont stockées en UTC ; la conversion vers Africa/Porto-Novo se fait à l'affichage.
 */
import mysql from "mysql2/promise";
import config from "./app.js";

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  queueLimit: 0,
  charset: "utf8mb4_unicode_ci", // même classement que les tables (MariaDB refuse les mélanges de classements)
  timezone: "Z",
  supportBigNumbers: true,
  namedPlaceholders: false,
});

// Chaque connexion travaille en UTC : CURRENT_TIMESTAMP et les DATETIME restent cohérents quel que soit le fuseau
// du serveur. Classement utf8mb4_unicode_ci, celui des tables : sur MariaDB, comparer une valeur envoyée par
// l'application à un texte de la requête échouait sinon (« Illegal mix of collations »).
pool.pool.on("connection", (connection) => {
  connection.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
  connection.query("SET time_zone = '+00:00'");
});

/** Exécute `work(connection)` dans une transaction (commit / rollback automatiques). */
export async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function checkDatabaseConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error.code, message: error.message };
  }
}

export default pool;
