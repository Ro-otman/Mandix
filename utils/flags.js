/**
 * Drapeaux des pays (SVG locaux de public/images/flags, bibliothèque flag-icons, licence MIT).
 * Les émojis drapeaux ne s'affichent pas sous Windows : on utilise toujours ces fichiers.
 */
import { COUNTRIES } from "../content/countries.js";

const KNOWN = new Set(COUNTRIES.map((c) => c.code));

export function flag(code, { size = 20, className = "" } = {}) {
  if (!KNOWN.has(code)) return "";
  const height = Math.round((size * 3) / 4);
  return `<img class="flag ${className}" src="/images/flags/${code.toLowerCase()}.svg" alt="" width="${size}" height="${height}" loading="lazy" decoding="async">`;
}
