/**
 * Messages flash sans session serveur : un cookie signé (COOKIE_SECRET), lu puis effacé à l'affichage suivant.
 * Usage dans un contrôleur : req.flash("success", "Mot de passe modifié.", "Titre facultatif"); puis res.redirect(...).
 * Les vues reçoivent res.locals.flash = [{ type, message, title? }] (affiché en toasts).
 */
import config from "../config/app.js";

const COOKIE = `${config.auth.cookiePrefix}mandix.flash`;
const TYPES = new Set(["success", "info", "warning", "danger"]);
const cookieOptions = { httpOnly: true, secure: config.isProduction, sameSite: "lax", path: "/", signed: true, maxAge: 5 * 60 * 1000 };

export function flash(req, res, next) {
  let pending = [];
  const raw = req.signedCookies?.[COOKIE];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        pending = parsed
          .filter((m) => TYPES.has(m?.type) && typeof m.message === "string" && (m.title === undefined || typeof m.title === "string"))
          .slice(0, 5);
      }
    } catch {
      pending = [];
    }
    res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
  }
  res.locals.flash = pending;

  const queued = [];
  req.flash = (type, message, title) => {
    const item = { type: TYPES.has(type) ? type : "info", message: String(message).slice(0, 300) };
    if (title) item.title = String(title).slice(0, 60);
    queued.push(item);
    res.cookie(COOKIE, JSON.stringify(queued), cookieOptions);
  };
  next();
}
