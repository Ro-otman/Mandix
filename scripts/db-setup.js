/**
 * Crée la base si nécessaire, applique database/schema.sql puis les seeds (ordre alphabétique).
 * Usage : npm run db:setup
 */
import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import config from "../config/app.js";

const databaseDir = path.join(config.rootDir, "database");
const { host, port, user, password, database } = config.db;

if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error("DB_NAME ne doit contenir que lettres, chiffres et _.");

const connection = await mysql.createConnection({ host, port, user, password, multipleStatements: true, charset: "utf8mb4" });

try {
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.query(`USE \`${database}\``);

  // schema.sql crée et sélectionne `mandix` ; on retire ces lignes pour respecter DB_NAME du .env.
  const schema = (await fs.readFile(path.join(databaseDir, "schema.sql"), "utf8"))
    .replace(/^\s*(CREATE DATABASE|USE)\b.*$/gim, "");
  await connection.query(schema);
  console.info("Schéma appliqué.");

  const seedDir = path.join(databaseDir, "seeds");
  const seeds = (await fs.readdir(seedDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of seeds) {
    await connection.query(await fs.readFile(path.join(seedDir, file), "utf8"));
    console.info(`Seed appliqué : ${file}`);
  }
} finally {
  await connection.end();
}
