/**
 * Installe le schéma et les données de référence dans une base EXISTANTE et VIDE, sans la créer
 * (hébergement mutualisé : la base est créée dans le panneau, l'utilisateur n'a pas le droit CREATE DATABASE).
 * Compatible MySQL 8 et MariaDB.
 *
 * Usage : node scripts/db-import-remote.js [fichier d'environnement]   (par défaut : .env.production)
 *   Le fichier doit contenir DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (jamais versionné).
 *
 * Sécurité : refuse de continuer si la base contient déjà des tables (aucun écrasement possible).
 * Les déclencheurs sont créés un par un : sur un serveur avec journal binaire, l'hébergeur peut les refuser
 * (droit SUPER requis) ; l'installation continue alors sans eux et le signale.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.resolve(root, process.argv[2] || ".env.production");

const env = Object.fromEntries((await fs.readFile(envFile, "utf8")).split(/\r?\n/)
  .filter((line) => /^[A-Z_]+=/.test(line))
  .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const key of ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]) {
  if (!env[key]) throw new Error(`${key} manquant dans ${path.basename(envFile)}`);
}

const connection = await mysql.createConnection({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 3306, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, multipleStatements: true, charset: "utf8mb4", connectTimeout: 20000,
});

try {
  const [[{ version }]] = await connection.query("SELECT VERSION() AS version");
  const [existing] = await connection.query("SHOW TABLES");
  if (existing.length) {
    throw new Error(`La base ${env.DB_NAME} contient déjà ${existing.length} table(s) : installation annulée (aucun écrasement).`);
  }
  console.info(`Base ${env.DB_NAME} vide (${version}) : installation…`);

  const schema = (await fs.readFile(path.join(root, "database", "schema.sql"), "utf8"))
    .replace(/^\s*(CREATE DATABASE|USE)\b.*$/gim, "");
  // Les déclencheurs (dernière section) sont créés séparément, un par un.
  const cut = schema.search(/^DROP TRIGGER IF EXISTS/m);
  const main = cut === -1 ? schema : schema.slice(0, cut);
  const triggers = cut === -1 ? [] : schema.slice(cut)
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);

  await connection.query(main);
  console.info("Tables et vues créées.");

  const seedDir = path.join(root, "database", "seeds");
  for (const file of (await fs.readdir(seedDir)).filter((f) => f.endsWith(".sql")).sort()) {
    await connection.query(await fs.readFile(path.join(seedDir, file), "utf8"));
    console.info(`Données de référence : ${file}`);
  }

  let created = 0;
  const refused = [];
  for (const statement of triggers) {
    try {
      await connection.query(statement);
      if (/^CREATE TRIGGER/i.test(statement)) created += 1;
    } catch (error) {
      refused.push(`${statement.match(/TRIGGER\s+(?:IF EXISTS\s+)?(\w+)/i)?.[1] ?? "?"} (${error.code})`);
    }
  }
  console.info(`Déclencheurs créés : ${created}${refused.length ? ` · refusés par le serveur : ${refused.join(", ")}` : ""}`);

  const [tables] = await connection.query("SHOW FULL TABLES");
  const views = tables.filter((t) => Object.values(t)[1] === "VIEW").length;
  const [[types]] = await connection.query("SELECT COUNT(*) AS n FROM account_types");
  console.info(`Terminé : ${tables.length - views} tables, ${views} vues, ${types.n} types de comptes.`);
} finally {
  await connection.end();
}
