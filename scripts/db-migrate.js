/**
 * Applique une migration (database/migrations/NNN_*.sql) à une base existante. MySQL 8 et MariaDB.
 *
 * Usage :
 *   node scripts/db-migrate.js 013_parcours_preuves_restrictions.sql                   (base du .env)
 *   node scripts/db-migrate.js 013_parcours_preuves_restrictions.sql .env.production   (autre base)
 *
 * Les migrations ne sont pas rejouables : vérifiez qu'elle n'a pas déjà été appliquée (le script s'arrête à la
 * première erreur, par exemple « colonne déjà existante », sans rien casser de plus).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [name, envArg] = process.argv.slice(2);
if (!name || !/^\d{3}_[\w-]+\.sql$/.test(name)) throw new Error("Indiquez le fichier de migration, ex. 013_parcours_preuves_restrictions.sql");

const envFile = path.resolve(root, envArg || ".env");
const env = Object.fromEntries((await fs.readFile(envFile, "utf8")).split(/\r?\n/)
  .filter((line) => /^[A-Z_]+=/.test(line))
  .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")]));

const connection = await mysql.createConnection({
  host: env.DB_HOST || "localhost", port: Number(env.DB_PORT) || 3306, user: env.DB_USER, password: env.DB_PASSWORD || "",
  database: env.DB_NAME, multipleStatements: true, charset: "utf8mb4", connectTimeout: 20000,
});
try {
  const sql = await fs.readFile(path.join(root, "database", "migrations", name), "utf8");
  await connection.query(sql);
  const [[{ version }]] = await connection.query("SELECT VERSION() AS version");
  console.info(`Migration ${name} appliquée sur ${env.DB_NAME} (${version}).`);
} finally {
  await connection.end();
}
