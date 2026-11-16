/**
 * Rendu des pages des espaces connectés (client, mandataire, administration) avec les données réelles :
 * layout tableau de bord, identité de l'utilisateur connecté, compteurs du menu (messages et notifications
 * non lus), recalculés à chaque page.
 */
import { avatarSvg, defaultAvatarSpec } from "../utils/avatar.js";
import { countsFor } from "./badgeService.js";

/** Compteurs du menu au chargement de la page ; ensuite mis à jour en direct (services/badgeService.js). */
export const menuBadges = countsFor;

export const userAvatar = (user, size = 36) => avatarSvg(defaultAvatarSpec(user.publicId), { size });

/** Rend une page d'espace avec le layout tableau de bord. */
export async function renderSpace(req, res, view, title, locals = {}) {
  const user = req.currentUser;
  res.locals.menuBadges = await menuBadges(user, req.mandataire?.id ?? null);
  res.locals.currentUser = { ...user, avatarSvg: userAvatar(user) };
  res.render(`${user.role}/${view}`, { layout: "layouts/dashboard", extraStyles: ["spaces"], dashboardRole: user.role, title, avatarSvg, ...locals });
}
