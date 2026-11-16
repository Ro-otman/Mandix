/**
 * Avatars illustrés (SVG en aplats, palette Mandix).
 * Utilisés pour les profils sans photo et pour les profils de démonstration :
 * on n'utilise JAMAIS une photo de banque d'images comme photo de profil.
 *
 * Spécification : { skin, hair, hairColor, outfit, background, accessory }
 *   skin       : 1 à 6 (du plus clair au plus foncé)
 *   hair       : "short" | "afro" | "bun" | "headwrap" | "braids" | "fade" | "long"
 *   outfit     : "blue" | "navy" | "emerald" | "gold" | "white" | "clay"
 *   background : "brume" | "menthe" | "or" | "sable" | "ciel"
 *   accessory  : null | "glasses"
 */

const SKIN = ["#e6b48a", "#c98d5f", "#a86b43", "#8a5333", "#6b3d24", "#4f2c1a"];
const SKIN_SHADE = ["#d29e74", "#b47a4e", "#925a36", "#744429", "#58301b", "#3e2214"];
const HAIR = { black: "#171717", brown: "#3b2416", grey: "#8a8f98" };
const OUTFIT = {
  blue: ["#1747b5", "#123a94"],
  navy: ["#0b1b3a", "#1d2f55"],
  emerald: ["#0c6b58", "#095646"],
  gold: ["#e9b23f", "#c9952c"],
  white: ["#ffffff", "#dfe5ee"],
  clay: ["#c2412d", "#a33522"],
};
const BACKGROUND = { brume: "#eaf1ff", menthe: "#e3f2ec", or: "#fbf1d9", sable: "#f3ece2", ciel: "#dbe8fb" };
const WRAP = { blue: "#1747b5", emerald: "#0c6b58", gold: "#e9b23f", clay: "#c2412d", navy: "#0b1b3a", white: "#e9b23f" };

function hairBehind(style, color) {
  switch (style) {
    case "afro":
      return `<circle cx="32" cy="24" r="16.5" fill="${color}"/>`;
    case "braids":
      return `<path d="M19 22c0-9 6-14 13-14s13 5 13 14v20c0 2-1.5 3-3 3h-2V27H24v18h-2c-1.5 0-3-1-3-3Z" fill="${color}"/>`;
    case "long":
      return `<path d="M19.5 26c0-10 5.5-15 12.5-15s12.5 5 12.5 15v14c0 2-1.5 3-3 3H22.5c-1.5 0-3-1-3-3Z" fill="${color}"/>`;
    default:
      return "";
  }
}

function hairFront(style, color, wrapColor) {
  switch (style) {
    case "short":
      return `<path d="M20.8 27c-.6-8.6 4.6-14 11.2-14s11.8 5.4 11.2 14c-1.6-4.4-5.6-7-11.2-7s-9.6 2.6-11.2 7Z" fill="${color}"/>`;
    case "fade":
      return `<path d="M21.3 25.5c.3-7.3 4.8-11.5 10.7-11.5s10.4 4.2 10.7 11.5c-2.4-3-6.2-4.6-10.7-4.6s-8.3 1.6-10.7 4.6Z" fill="${color}"/>`;
    case "afro":
      return `<path d="M21 26c1-6 5.2-9 11-9s10 3 11 9c-2.5-2.2-6.4-3.4-11-3.4S23.5 23.8 21 26Z" fill="${color}"/>`;
    case "bun":
      return `<circle cx="32" cy="10.5" r="5.5" fill="${color}"/><path d="M20.8 27c-.6-8.6 4.6-14 11.2-14s11.8 5.4 11.2 14c-1.6-4.4-5.6-7-11.2-7s-9.6 2.6-11.2 7Z" fill="${color}"/>`;
    case "braids":
    case "long":
      return `<path d="M20.8 27.5c-.6-8.8 4.6-14.5 11.2-14.5s11.8 5.7 11.2 14.5c-2.2-5-6-7.6-11.2-7.6s-9 2.6-11.2 7.6Z" fill="${color}"/>`;
    case "headwrap":
      return (
        `<path d="M18.5 25.5c-.4-10.5 6-16.5 13.5-16.5s13.9 6 13.5 16.5c-3.8-3.4-8.4-4.8-13.5-4.8s-9.7 1.4-13.5 4.8Z" fill="${wrapColor}"/>` +
        `<path d="M36 10.5c4-3.5 9-3 10.5.5-2.5-.5-5 .2-7 2.2Z" fill="${wrapColor}"/>` +
        `<path d="M21 21.5c3.5-2.4 7-3.4 11-3.4s7.5 1 11 3.4" fill="none" stroke="#ffffff" stroke-opacity=".35" stroke-width="1.4" stroke-linecap="round"/>`
      );
    default:
      return "";
  }
}

/** Retourne le SVG (chaîne) d'un avatar. `label` fournit le texte alternatif. */
export function avatarSvg(spec = {}, { size = 64, label = "", className = "" } = {}) {
  const skinIndex = Math.min(Math.max((spec.skin ?? 3) - 1, 0), SKIN.length - 1);
  const skin = SKIN[skinIndex];
  const shade = SKIN_SHADE[skinIndex];
  const hairColor = HAIR[spec.hairColor] ?? HAIR.black;
  const [cloth, clothShade] = OUTFIT[spec.outfit] ?? OUTFIT.blue;
  const background = BACKGROUND[spec.background] ?? BACKGROUND.brume;
  const style = spec.hair ?? "short";
  const wrapColor = WRAP[spec.outfit] ?? WRAP.gold;
  const collar = spec.outfit === "white" ? "#1747b5" : "#ffffff";
  const a11y = label ? `role="img" aria-label="${String(label).replace(/"/g, "&quot;")}"` : 'aria-hidden="true"';

  const glasses =
    spec.accessory === "glasses"
      ? `<g fill="none" stroke="#0b1b3a" stroke-width="1.3"><circle cx="27.6" cy="29.3" r="3.1"/><circle cx="36.4" cy="29.3" r="3.1"/><path d="M30.7 29.3h2.6"/></g>`
      : "";

  return (
    `<svg class="avatar-svg ${className}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" ${a11y}>` +
    `<rect width="64" height="64" fill="${background}"/>` +
    hairBehind(style, hairColor) +
    // buste et col
    `<path d="M9 64c1.8-11.5 11-18 23-18s21.2 6.5 23 18Z" fill="${cloth}"/>` +
    `<path d="M26 46.5 32 54l6-7.5c-1.9-.4-3.9-.6-6-.6s-4.1.2-6 .6Z" fill="${collar}"/>` +
    `<path d="M9 64c.6-3.9 2-7.3 4-10.1L18 64Z" fill="${clothShade}" opacity=".6"/>` +
    // cou
    `<path d="M28 38h8v8.5c-1.2 1.2-2.6 1.8-4 1.8s-2.8-.6-4-1.8Z" fill="${shade}"/>` +
    // tête et oreilles
    `<ellipse cx="20.7" cy="30" rx="2" ry="2.8" fill="${shade}"/><ellipse cx="43.3" cy="30" rx="2" ry="2.8" fill="${shade}"/>` +
    `<ellipse cx="32" cy="28.5" rx="11.3" ry="13" fill="${skin}"/>` +
    hairFront(style, hairColor, wrapColor) +
    // visage (yeux, sourire)
    `<circle cx="27.6" cy="29.6" r="1.25" fill="#0b1b3a"/><circle cx="36.4" cy="29.6" r="1.25" fill="#0b1b3a"/>` +
    `<path d="M28.8 34.6c1.9 1.6 4.5 1.6 6.4 0" fill="none" stroke="#0b1b3a" stroke-width="1.3" stroke-linecap="round"/>` +
    glasses +
    `</svg>`
  );
}

/** Avatar par défaut, déduit d'une graine (ex. le slug) : stable d'une page à l'autre. */
export function defaultAvatarSpec(seed = "") {
  let hash = 0;
  for (const ch of String(seed)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const pick = (list, shift) => list[(hash >>> shift) % list.length];
  return {
    skin: (hash % 4) + 3,
    hair: pick(["short", "afro", "bun", "headwrap", "fade", "braids"], 3),
    outfit: pick(["blue", "navy", "emerald", "white"], 7),
    background: pick(["brume", "menthe", "or", "sable"], 11),
  };
}
