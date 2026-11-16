/**
 * Disponibilité d'un mandataire : « En ligne » ou « En ligne il y a 12 min ».
 * Même règle que public/js/app.js (mise à jour du libellé côté navigateur toutes les 30 s).
 * Avec le backend, lastSeenAt sera mis à jour par l'activité réelle du mandataire.
 */
const MINUTE = 60 * 1000;
const ONLINE_WINDOW = 2 * MINUTE;

export function presence(lastSeenAt, now = Date.now()) {
  if (!lastSeenAt) return { online: false, label: "Hors ligne", iso: null };
  const date = new Date(lastSeenAt);
  const diff = Math.max(0, now - date.getTime());
  const iso = date.toISOString();
  if (diff < ONLINE_WINDOW) return { online: true, label: "En ligne", iso };
  const minutes = Math.floor(diff / MINUTE);
  if (minutes < 60) return { online: false, label: `En ligne il y a ${minutes} min`, iso };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { online: false, label: `En ligne il y a ${hours} h`, iso };
  const days = Math.floor(hours / 24);
  return { online: false, label: `En ligne il y a ${days} j`, iso };
}
