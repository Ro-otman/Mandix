/**
 * Résolution des emplacements photo (content/photos.js) vers un fichier de public/images/photos/.
 * En production, le résultat est mis en cache ; en développement, un fichier déposé apparaît
 * immédiatement au rechargement de la page.
 */
import fs from "node:fs";
import path from "node:path";
import config from "../config/app.js";
import { PHOTO_SLOTS } from "../content/photos.js";

const photosDir = path.join(config.rootDir, "public", "images", "photos");
const EXTENSIONS = [".webp", ".jpg", ".jpeg"];
const cache = new Map();

function findFile(slot) {
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(path.join(photosDir, `${slot}${ext}`))) return `/images/photos/${slot}${ext}`;
  }
  return null;
}

/** Retourne { src | null, alt, label, icon } pour un emplacement déclaré. */
export function photo(slot) {
  const meta = PHOTO_SLOTS[slot];
  if (!meta) throw new Error(`Emplacement photo inconnu : ${slot}`);
  if (config.isProduction && cache.has(slot)) return cache.get(slot);
  const result = { ...meta, src: findFile(slot) };
  if (config.isProduction) cache.set(slot, result);
  return result;
}
