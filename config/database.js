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
  charset: "utf8mb4",
  timezone: "Z",
  supportBigNumbers: true,
  namedPlaceholders: false,
});

// Chaque connexion travaille en UTC : CURRENT_TIMESTAMP et les DATETIME restent cohérents
// quel que soit le fuseau du serveur MySQL.
pool.pool.on("connection", (connection) => {
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
