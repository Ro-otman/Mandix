/**
 * Authentification par jetons, à chaque requête :
 *  1. le jeton d'accès (cookie HttpOnly) est vérifié : signature, émetteur, audience, expiration ;
 *  2. la session qu'il désigne est relue en base : active, non révoquée, compte actif (une déconnexion,
 *     une réinitialisation du mot de passe ou une suspension s'appliquent donc immédiatement) ;
 *  3. jeton d'accès absent ou expiré : le jeton de rafraîchissement est échangé contre une nouvelle paire
 *     (rotation), de façon transparente pour l'utilisateur.
 * Résultat : req.currentUser (et res.locals.currentUser pour les vues), req.auth (session courante).
 *
 * Sessions par espace : le navigateur peut détenir une session client, une session mandataire et une session
 * administrateur en même temps (un onglet par compte). La requête utilise la session de l'espace qu'elle vise
 * (voir requestedSpace) ; une page publique utilise le dernier espace visité. req.authSpaces liste les espaces
 * pour lesquels le navigateur présente des cookies de connexion.
 */
import { AuthSession } from "../models/AuthSession.js";
import { ROLE_HOME } from "./authorize.js";
import pool from "../config/database.js";
import {
  verifyAccessToken, signAccessToken, rotateRefreshToken, setAuthCookies, clearAuthCookies, cookieNames,
  isSpace, spacesWithCookies, LEGACY_COOKIES, clearLegacyCookies, LAST_SPACE_COOKIE, rememberLastSpace,
} from "../services/tokenService.js";

const initialsOf = (name) =>
  String(name || "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "?";

/** Utilisateur exposé à l'application et aux vues (jamais le hash du mot de passe). */
function toCurrentUser(row) {
  const displayName = row.pseudo || [row.first_name, row.last_name].filter(Boolean).join(" ");
  return Object.freeze({
    id: row.id,
    publicId: row.public_id,
    role: row.role,
    adminRole: row.admin_role ?? null,
    email: row.email,
    pseudo: row.pseudo,
    displayName,
    firstName: displayName, // salutation dans l'en-tête des espaces
    initials: initialsOf(displayName),
    dashboardPath: ROLE_HOME[row.role],
    memberSince: row.created_at,
  });
}

/** Présence « En ligne » : au plus une écriture par minute et par utilisateur. */
const lastSeenWrites = new Map();
function touchLastSeen(userId) {
  const now = Date.now();
  if (now - (lastSeenWrites.get(userId) || 0) < 60_000) return;
  lastSeenWrites.set(userId, now);
  if (lastSeenWrites.size > 10_000) lastSeenWrites.clear();
  pool.execute("UPDATE users SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?", [userId]).catch(() => {});
}

const context = (req) => ({ ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) ?? null });

/**
 * Espace visé par la requête :
 *  - chemin /client…, /mandataire…, /admin… (y compris /mandataire/inscription) ; /inscription → client ;
 *  - sinon indication explicite : en-tête X-Mandix-Space (appels JavaScript des espaces), paramètre ou champ
 *    « espace » (connexion, déconnexion, liens de fichiers) ;
 *  - /connexion sans précision : onglet Client.
 * null : page publique (accueil, recherche…).
 */
export function requestedSpace(req) {
  const first = req.path.split("/")[1];
  if (isSpace(first)) return first;
  if (req.path === "/inscription") return "client";
  const hint = req.get("x-mandix-space") || req.query?.espace || req.body?.espace;
  if (isSpace(hint)) return hint;
  if (req.path === "/connexion") {
    // Page à rouvrir après connexion (« suite ») : son espace, jamais la session d'un autre compte.
    const target = String(req.query?.suite || req.body?.suite || "").split(/[/?]/)[1];
    return isSpace(target) ? target : "client";
  }
  return null;
}

/** Page de connexion d'un espace : l'administration et l'espace mandataire ont la leur. */
const LOGIN_QUERY = Object.freeze({ admin: "espace=admin", mandataire: "espace=mandataire" });

/**
 * Session de l'espace `space` présentée par le navigateur : jeton d'accès, sinon rotation du jeton de
 * rafraîchissement. Cookies invalides (expirés, révoqués, falsifiés, ou d'un autre rôle) : effacés.
 */
async function resolveSession(req, res, space) {
  const names = cookieNames(space);
  const accessToken = req.cookies?.[names.access];
  const refreshToken = req.cookies?.[names.refresh];
  if (!accessToken && !refreshToken) return null;
  let row = null;

  const payload = accessToken ? await verifyAccessToken(accessToken) : null;
  if (payload) {
    row = await AuthSession.findActiveWithUser(payload.sid);
    if (row && row.public_id !== payload.sub) row = null; // jeton incohérent avec la session
  }

  if (!row && refreshToken) {
    const result = await rotateRefreshToken(refreshToken, context(req));
    if (result.ok) {
      row = await AuthSession.findActiveWithUser(result.sessionPublicId);
      if (row && row.role === space) {
        const newAccess = await signAccessToken({ userPublicId: row.public_id, role: row.role, sessionPublicId: row.session_public_id });
        setAuthCookies(res, space, {
          accessToken: newAccess,
          refreshToken: result.refreshToken, // absent pendant le délai de tolérance : le cookie actuel reste
          remember: result.remember,
          refreshMaxAgeSeconds: result.refreshMaxAgeSeconds,
        });
      }
    }
  }

  if (row && row.role !== space) row = null; // les cookies d'un espace ne portent que des sessions de ce rôle
  if (!row) clearAuthCookies(res, space);
  return row;
}

export async function authenticate(req, res, next) {
  req.currentUser = null;
  req.auth = null;
  req.authSpaces = [];
  res.locals.currentUser = null;
  res.locals.authSpaces = [];
  try {
    if (LEGACY_COOKIES.some((name) => req.cookies?.[name])) clearLegacyCookies(res);
    let available = spacesWithCookies(req.cookies);
    const wanted = requestedSpace(req);
    let row = null;

    // Espace précis : sa session uniquement (jamais celle d'un autre compte ouvert dans le navigateur).
    // Page publique : dernier espace visité, puis les autres.
    const last = req.cookies?.[LAST_SPACE_COOKIE];
    const candidates = wanted
      ? [wanted]
      : isSpace(last) && available.includes(last) ? [last, ...available.filter((s) => s !== last)] : available;
    for (const space of candidates) {
      if (!available.includes(space)) continue;
      row = await resolveSession(req, res, space);
      if (row) break;
      available = available.filter((s) => s !== space); // cookies invalides : effacés
    }
    req.authSpaces = available;
    res.locals.authSpaces = available;

    if (!row) return next();
    if (wanted && req.path.split("/")[1] === wanted) rememberLastSpace(req, res, wanted);

    req.auth = { sessionId: row.session_id, sessionPublicId: row.session_public_id, remember: Boolean(row.remember) };
    req.currentUser = toCurrentUser(row);
    res.locals.currentUser = req.currentUser;
    touchLastSeen(row.id);
    return next();
  } catch (error) {
    return next(error);
  }
}

/** Bloque l'accès aux visiteurs non connectés ; après connexion, retour à la page demandée. */
export function requireAuth(req, res, next) {
  if (req.currentUser) return next();
  res.set("Cache-Control", "no-store");
  // Panneau latéral chargé en JavaScript : pas de redirection (la page de connexion s'afficherait dans le panneau).
  if (req.get("X-Mandix-Panel") === "1") return res.status(401).type("text/plain").send("Session expirée : rechargez la page.");
  // La connexion s'ouvre sur l'espace demandé (ex. /admin → connexion administrateur), même si le navigateur
  // détient déjà la session d'un autre espace : elle ne redirige donc jamais vers un autre compte.
  // req.path est relatif au routeur (ex. « /dashboard » sous « /admin ») : l'espace se lit sur l'URL d'origine.
  const first = req.originalUrl.split(/[/?]/)[1];
  const spaceQuery = LOGIN_QUERY[isSpace(first) ? first : requestedSpace(req)];
  if (req.method === "GET") return res.redirect(`/connexion?${spaceQuery ? `${spaceQuery}&` : ""}suite=${encodeURIComponent(req.originalUrl)}`);
  return res.redirect(303, spaceQuery ? `/connexion?${spaceQuery}` : "/connexion");
}

/** Réservé aux visiteurs non connectés (connexion, inscription, mot de passe oublié). */
export function requireGuest(req, res, next) {
  if (!req.currentUser) return next();
  return res.redirect(req.currentUser.dashboardPath);
}
