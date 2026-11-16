/**
 * Protection CSRF sans session serveur (« double submit » signé, bibliothèque csrf-csrf).
 * Le jeton, signé par HMAC avec CSRF_SECRET, est lié au navigateur (identifiant aléatoire en cookie HttpOnly,
 * préfixé __Host- en production) : un jeton volé ailleurs ne sert à rien. Il n'est pas lié à la session : un
 * navigateur peut avoir plusieurs sessions ouvertes (client et mandataire, un onglet chacun) qui partagent
 * alors le même jeton, sans que l'un des onglets invalide les formulaires de l'autre.
 * Chaque formulaire POST inclut : <input type="hidden" name="_csrf" value="<%= csrfToken %>">
 * Les requêtes JavaScript l'envoient dans l'en-tête X-CSRF-Token.
 */
import { doubleCsrf } from "csrf-csrf";
import config from "../config/app.js";
import { randomToken } from "../utils/crypto.js";
import { HttpError } from "../utils/httpError.js";

const prefix = config.auth.cookiePrefix;
const VISITOR_COOKIE = `${prefix}mandix.vid`;
const cookieBase = { httpOnly: true, secure: config.isProduction, sameSite: "lax", path: "/" };

/** Identifiant anonyme du navigateur (aucun suivi : sert uniquement à lier le jeton CSRF). */
export function visitorId(req, res, next) {
  let id = req.cookies?.[VISITOR_COOKIE];
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22,64}$/.test(id)) {
    id = randomToken(18);
    res.cookie(VISITOR_COOKIE, id, { ...cookieBase, maxAge: 365 * 24 * 3600 * 1000 });
  }
  req.visitorId = id;
  next();
}

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => config.csrfSecret,
  getSessionIdentifier: (req) => `v:${req.visitorId}`,
  cookieName: `${prefix}mandix.csrf`,
  cookieOptions: { ...cookieBase, sameSite: "strict" },
  getCsrfTokenFromRequest: (req) => req.body?._csrf || req.get("x-csrf-token"),
});

/** Jeton disponible dans toutes les vues (formulaires) et pour les scripts (balise meta). */
export function exposeCsrfToken(req, res, next) {
  res.locals.csrfToken = generateCsrfToken(req, res);
  next();
}

/** Vérifie POST/PUT/PATCH/DELETE ; GET/HEAD/OPTIONS ne doivent jamais modifier de données. */
export function csrfProtection(req, res, next) {
  doubleCsrfProtection(req, res, (error) => {
    if (error) return next(new HttpError(403, "Votre formulaire a expiré. Rechargez la page et réessayez."));
    next();
  });
}
