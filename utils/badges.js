/**
 * Badges d'identité affichés à côté du nom d'un mandataire.
 * - verifiedBadge : rosette festonnée bleue avec coche blanche (dessin propre à Mandix).
 *   À n'afficher QUE si la vérification (identité + mandat bancaire) a réellement été faite.
 * - certifiedBadge : même rosette, dorée, avec une étoile blanche ; attribuée automatiquement à partir de
 *   CERTIFICATION_THRESHOLD transactions. Toujours placée juste après le badge « vérifié », à côté du nom.
 */

/** Nombre de transactions à partir duquel un mandataire est certifié. */
export const CERTIFICATION_THRESHOLD = 1000;

// Contour de rosette à 8 festons, calculé une fois : r(θ) = R · (1 + a·cos(8θ)).
const ROSETTE = (() => {
  const points = [];
  const steps = 96;
  for (let i = 0; i < steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const r = 10.2 * (1 + 0.075 * Math.cos(8 * t));
    points.push(`${(12 + r * Math.cos(t)).toFixed(2)} ${(12 + r * Math.sin(t)).toFixed(2)}`);
  }
  return `M${points.join("L")}Z`;
})();

// Étoile à 5 branches centrée dans la rosette.
const STAR = (() => {
  const points = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? 5.6 : 2.45;
    const t = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${(12 + r * Math.cos(t)).toFixed(2)} ${(12.35 + r * Math.sin(t)).toFixed(2)}`);
  }
  return `M${points.join("L")}Z`;
})();

const escapeAttr = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function verifiedBadge({ size = 18, label = "Profil vérifié", className = "" } = {}) {
  return `<svg class="verified-badge ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" role="img" aria-label="${escapeAttr(label)}"><title>${escapeAttr(label)}</title><path d="${ROSETTE}" fill="currentColor"/><path d="M7.6 12.3l3 3 5.8-6.2" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function certifiedBadge({ size = 18, label = "Mandataire certifié (1 000 transactions et plus)", className = "" } = {}) {
  return `<svg class="certified-badge ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" role="img" aria-label="${escapeAttr(label)}"><title>${escapeAttr(label)}</title><path d="${ROSETTE}" fill="currentColor"/><path d="${STAR}" fill="#fff" stroke="#fff" stroke-width="0.6" stroke-linejoin="round"/></svg>`;
}

export const isCertified = (transactions) => Number(transactions) >= CERTIFICATION_THRESHOLD;
