/**
 * Rendu des pages des espaces connectés (client, mandataire, administration) avec les données réelles :
 * layout tableau de bord, identité de l'utilisateur connecté, compteurs du menu (messages et notifications
 * non lus), recalculés à chaque page.
 */
import { avatarSvg, defaultAvatarSpec } from "../utils/avatar.js";
import { countsFor } from "./badgeService.js";
import pool from "../config/database.js";
import config from "../config/app.js";
import { LIMIT_TIERS, tierFor, limitLabel } from "../utils/limits.js";

/** Compteurs du menu au chargement de la page ; ensuite mis à jour en direct (services/badgeService.js). */
export const menuBadges = countsFor;

export const userAvatar = (user, size = 36) => avatarSvg(defaultAvatarSpec(user.publicId), { size });

/**
 * Fenêtre « Comprendre les niveaux » de l'espace mandataire (views/partials/dash/levels-dialog.ejs) : niveau et
 * plafond actuels (niveau bloqué pendant une restriction), prochain palier, lien public de la fiche (une fois
 * publiée) ; ouverte d'elle-même tant que le mandataire ne l'a pas fermée.
 */
export async function levelsIntroFor(mandataire) {
  const done = Number(mandataire.level_transactions ?? mandataire.transactions_count) || 0;
  const tier = tierFor(done);
  const next = LIMIT_TIERS.find((t) => t.from > done) || null;
  const [[published]] = await pool.execute(
    "SELECT EXISTS (SELECT 1 FROM mandataire_accounts WHERE mandataire_id = ? AND status = 'published') AS yes",
    [mandataire.id],
  );
  return {
    done,
    level: tier.level,
    limitText: limitLabel(tier.limitEur),
    next: next ? { level: next.level, left: next.from - done, limitText: limitLabel(next.limitEur) } : null,
    tiers: LIMIT_TIERS.map((t) => ({ level: t.level, from: t.from, certification: Boolean(t.certification), limitText: limitLabel(t.limitEur) })),
    profileUrl: Number(published.yes) ? `${config.baseUrl.replace(/\/+$/, "")}/mandataires/${encodeURIComponent(mandataire.slug)}` : null,
    autoOpen: !mandataire.levels_intro_seen_at,
  };
}

/** Rend une page d'espace avec le layout tableau de bord. */
export async function renderSpace(req, res, view, title, locals = {}) {
  const user = req.currentUser;
  res.locals.menuBadges = await menuBadges(user, req.mandataire?.id ?? null);
  if (user.role === "mandataire" && req.mandataire) res.locals.levelsIntro = await levelsIntroFor(req.mandataire);
  res.locals.currentUser = { ...user, avatarSvg: userAvatar(user) };
  res.render(`${user.role}/${view}`, { layout: "layouts/dashboard", extraStyles: ["spaces"], dashboardRole: user.role, title, avatarSvg, ...locals });
}
