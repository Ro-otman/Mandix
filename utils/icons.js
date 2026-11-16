/**
 * Icônes Lucide rendues côté serveur (SVG inline) : aucune dépendance JavaScript,
 * aucun saut d'affichage, compatible avec la CSP stricte.
 * Usage dans une vue : <%- icon('shield-check', { size: 20, className: 'text-success' }) %>
 */
import fs from "node:fs";
import path from "node:path";
import config from "../config/app.js";

const iconsDir = path.join(config.rootDir, "node_modules", "lucide-static", "icons");
const cache = new Map();

function loadSvg(name) {
  if (cache.has(name)) return cache.get(name);
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Nom d'icône invalide : ${name}`);
  const raw = fs.readFileSync(path.join(iconsDir, `${name}.svg`), "utf8");
  // Retire le commentaire de licence et l'en-tête <svg ...> : on reconstruit nos propres attributs.
  const inner = raw.replace(/<!--[\s\S]*?-->/, "").replace(/<svg[\s\S]*?>/, "").replace("</svg>", "").trim();
  if (config.isProduction) cache.set(name, inner);
  return inner;
}

const escapeAttr = (value) => String(value).replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]);

export function icon(name, { size = 20, className = "", label = null, strokeWidth = 2 } = {}) {
  const a11y = label ? `role="img" aria-label="${escapeAttr(label)}"` : 'aria-hidden="true" focusable="false"';
  return (
    `<svg class="icon ${escapeAttr(className)}" xmlns="http://www.w3.org/2000/svg" width="${Number(size)}" height="${Number(size)}" ` +
    `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${Number(strokeWidth)}" ` +
    `stroke-linecap="round" stroke-linejoin="round" ${a11y}>${loadSvg(name)}</svg>`
  );
}
