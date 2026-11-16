/**
 * Chemin public d'un fichier front (feuille de style ou script), exposé aux vues : asset("js/app.js").
 *
 * - Production (ou ASSETS=dist) : fichier construit par webpack, minifié et nommé avec une empreinte de contenu
 *   (public/dist/manifest.json, généré par `npm run build`). Servi avec un cache d'un an (voir app.js).
 * - Développement : fichier source (public/js/app.js), pour voir ses modifications sans reconstruire.
 * Si le manifeste est absent (construction oubliée), on retombe sur le fichier source : le site reste utilisable,
 * et un avertissement est écrit au démarrage.
 */
import fs from "node:fs";
import path from "node:path";
import config from "../config/app.js";

const MANIFEST = path.join(config.rootDir, "public", "dist", "manifest.json");
export const useBuiltAssets = config.isProduction || process.env.ASSETS === "dist";

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch {
    return null;
  }
}

const manifest = useBuiltAssets ? readManifest() : null;
if (useBuiltAssets && !manifest) {
  console.warn("Fichiers front non construits (public/dist/manifest.json absent) : lancez « npm run build ». Fichiers sources utilisés.");
}

/** « js/app.js » -> « /dist/js/app.b0bf03ad.js » (construit) ou « /js/app.js » (source). */
export function asset(file) {
  const key = String(file).replace(/^\/+/, "");
  return (manifest && manifest[key]) || `/${key}`;
}
