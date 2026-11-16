/**
 * Génère database/mandix.sql : un fichier unique (création de la base + schéma + seeds),
 * importable dans phpMyAdmin, MySQL Workbench ou via `mysql -u root -p < database/mandix.sql`.
 * Usage : npm run db:bundle   (à relancer après toute modification de schema.sql ou des seeds)
 */
import fs from "node:fs/promises";
import path from "node:path";
import config from "../config/app.js";

const databaseDir = path.join(config.rootDir, "database");
const seedDir = path.join(databaseDir, "seeds");
const seeds = (await fs.readdir(seedDir)).filter((f) => f.endsWith(".sql")).sort();

const parts = [
  `-- =============================================================================
-- Mandix — script complet d'installation de la base de données
-- Fichier GÉNÉRÉ par scripts/build-sql-bundle.js : ne pas modifier à la main.
-- Sources : database/schema.sql (qui crée la base \`mandix\`) + database/seeds/*.sql
-- =============================================================================
`,
  await fs.readFile(path.join(databaseDir, "schema.sql"), "utf8"),
];

for (const file of seeds) {
  parts.push(`\n-- ----- Seed : ${file} -----\n`, await fs.readFile(path.join(seedDir, file), "utf8"));
}

const outputPath = path.join(databaseDir, "mandix.sql");
await fs.writeFile(outputPath, parts.join("\n"));
console.info(`Généré : ${path.relative(config.rootDir, outputPath)}`);
