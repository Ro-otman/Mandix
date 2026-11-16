/**
 * Jetons de connexion.
 *
 *  - Jeton d'accès : JWT signé (HS256, bibliothèque jose), valable 15 minutes. Il porte l'identifiant public de
 *    l'utilisateur (sub), son rôle et l'identifiant de session (sid). Chaque requête vérifie aussi en base que la
 *    session est active : une déconnexion ou une suspension s'applique immédiatement, sans attendre l'expiration.
 *  - Jeton de rafraîchissement : 256 bits aléatoires, opaques, dont seule l'empreinte SHA-256 est stockée.
 *    Il est remplacé à chaque usage (rotation). Présenter un jeton déjà remplacé signale un vol : la session
 *    entière est révoquée (après 30 s de tolérance, pour les requêtes simultanées d'un même navigateur).
 *
 * Les deux jetons voyagent en cookies HttpOnly (inaccessibles au JavaScript de la page, donc à une faille XSS),
 * SameSite=Lax, Secure et préfixés __Host- en production.
 *
 * Une paire de cookies par espace (client, mandataire, admin) : un même navigateur peut être connecté à la fois
 * à un compte client et à un compte mandataire, chacun dans son onglet. Chaque requête utilise la session de
 * l'espace demandé (middlewares/authenticate.js).
 */
import { SignJWT, jwtVerify } from "jose";
import config from "../config/app.js";
import { withTransaction } from "../config/database.js";
import { AuthSession } from "../models/AuthSession.js";
import { AuditLog } from "../models/Security.js";
import { randomToken, sha256, uuid, isTokenShape } from "../utils/crypto.js";

const { auth } = config;
const signingKey = new TextEncoder().encode(auth.accessSecret);

/* ------------------------------------------------------------------ Cookies */

/** Espaces connectés, dans l'ordre de préférence quand la requête ne précise pas d'espace. */
export const SPACES = Object.freeze(["client", "mandataire", "admin"]);
export const isSpace = (value) => SPACES.includes(value);

/** Noms des cookies de connexion d'un espace. */
export const cookieNames = (space) => ({
  access: `${auth.cookiePrefix}mandix.at.${space}`,
  refresh: `${auth.cookiePrefix}mandix.rt.${space}`,
});

/** Anciens cookies (une seule session par navigateur, avant les sessions par espace) : effacés s'ils traînent. */
export const LEGACY_COOKIES = Object.freeze([`${auth.cookiePrefix}mandix.at`, `${auth.cookiePrefix}mandix.rt`]);

/** Dernier espace utilisé : choisit la session affichée sur les pages publiques (accueil, recherche…). */
export const LAST_SPACE_COOKIE = `${auth.cookiePrefix}mandix.space`;

const baseCookie = { httpOnly: true, secure: config.isProduction, sameSite: "lax", path: "/" };

/** Espaces pour lesquels le navigateur présente des cookies de connexion (non vérifiés : simple indication). */
export const spacesWithCookies = (cookies = {}) =>
  SPACES.filter((space) => cookies[cookieNames(space).access] || cookies[cookieNames(space).refresh]);

/**
 * Pose les cookies de connexion de l'espace `space` (= rôle du compte). Sans « Rester connecté », le jeton de
 * rafraîchissement est un cookie de session (effacé à la fermeture du navigateur) ; la session expire de toute
 * façon côté serveur après 12 h. Les cookies des autres espaces ne sont pas touchés.
 */
export function setAuthCookies(res, space, { accessToken, refreshToken, remember, refreshMaxAgeSeconds }) {
  if (!isSpace(space)) throw new Error(`Espace inconnu : ${space}`);
  const names = cookieNames(space);
  res.cookie(names.access, accessToken, { ...baseCookie, maxAge: auth.accessTtlSeconds * 1000 });
  if (refreshToken) {
    const persistent = remember && refreshMaxAgeSeconds > 0 ? { maxAge: refreshMaxAgeSeconds * 1000 } : {};
    res.cookie(names.refresh, refreshToken, { ...baseCookie, ...persistent });
  }
}

/** Efface les cookies de connexion d'un espace (sans argument : de tous les espaces). */
export function clearAuthCookies(res, space = null) {
  for (const s of space ? [space] : SPACES) {
    const names = cookieNames(s);
    res.clearCookie(names.access, baseCookie);
    res.clearCookie(names.refresh, baseCookie);
  }
}

export function clearLegacyCookies(res) {
  for (const name of LEGACY_COOKIES) res.clearCookie(name, baseCookie);
}

export function rememberLastSpace(req, res, space) {
  if (req.cookies?.[LAST_SPACE_COOKIE] === space) return;
  res.cookie(LAST_SPACE_COOKIE, space, { ...baseCookie, maxAge: 30 * 24 * 3600 * 1000 });
}

/* ------------------------------------------------------------------ Jeton d'accès (JWT) */

export async function signAccessToken({ userPublicId, role, sessionPublicId }) {
  return new SignJWT({ role, sid: sessionPublicId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userPublicId)
    .setIssuer(auth.issuer)
    .setAudience(auth.audience)
    .setIssuedAt()
    .setJti(uuid())
    .setExpirationTime(Math.floor(Date.now() / 1000) + auth.accessTtlSeconds)
    .sign(signingKey);
}

/** Charge utile du jeton s'il est authentique et non expiré ; null sinon (sans jamais lever d'erreur). */
export async function verifyAccessToken(token) {
  if (typeof token !== "string" || token.length > 2048) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey, {
      issuer: auth.issuer,
      audience: auth.audience,
      algorithms: ["HS256"], // refuse tout autre algorithme (dont « none »)
      clockTolerance: 5,
    });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ Sessions et jetons de rafraîchissement */

const ttlFor = (remember) => (remember ? auth.rememberTtlSeconds : auth.sessionTtlSeconds);

/**
 * Ouvre une session pour un utilisateur authentifié (connexion) et renvoie les deux jetons.
 * @returns {{accessToken: string, refreshToken: string, remember: boolean, refreshMaxAgeSeconds: number, sessionPublicId: string}}
 */
export async function openSession(user, { remember, userAgent, ip }) {
  const sessionPublicId = uuid();
  const refreshToken = randomToken(32);
  const ttlSeconds = ttlFor(remember);
  await withTransaction(async (connection) => {
    const sessionId = await AuthSession.create(
      { publicId: sessionPublicId, userId: user.id, remember, userAgent: userAgent?.slice(0, 255) ?? null, ip, ttlSeconds },
      connection,
    );
    await AuthSession.addRefreshToken({ sessionId, tokenHash: sha256(refreshToken), ttlSeconds }, connection);
  });
  const accessToken = await signAccessToken({ userPublicId: user.public_id, role: user.role, sessionPublicId });
  return { accessToken, refreshToken, remember: Boolean(remember), refreshMaxAgeSeconds: ttlSeconds, sessionPublicId };
}

/**
 * Échange un jeton de rafraîchissement contre un nouveau (rotation).
 * @returns {Promise<{ok: true, sessionPublicId: string, remember: boolean, refreshToken?: string, refreshMaxAgeSeconds?: number}
 *                 | {ok: false, reason: string}>}
 */
export async function rotateRefreshToken(rawToken, { userAgent, ip } = {}) {
  if (!isTokenShape(rawToken)) return { ok: false, reason: "malformed" };
  const tokenHash = sha256(rawToken);

  return withTransaction(async (connection) => {
    const row = await AuthSession.findRefreshForUpdate(tokenHash, connection);
    if (!row) return { ok: false, reason: "unknown" };
    if (!row.session_valid) return { ok: false, reason: "session_ended" };

    if (row.rotated_at) {
      // Requêtes simultanées du même navigateur : l'une a déjà renouvelé le jeton il y a quelques secondes.
      if (row.rotated_seconds_ago !== null && row.rotated_seconds_ago <= auth.refreshGraceSeconds) {
        return { ok: true, sessionPublicId: row.session_public_id, remember: Boolean(row.remember) };
      }
      // Jeton déjà remplacé, présenté de nouveau : vol présumé. Toute la session est fermée.
      await AuthSession.revoke(row.session_id, "reuse_detected", connection);
      await AuditLog.record(
        { actorUserId: row.user_id, action: "auth.refresh_reuse", entityType: "auth_session", entityId: row.session_id, ip, userAgent },
        connection,
      );
      return { ok: false, reason: "reuse_detected" };
    }

    if (!row.token_valid) return { ok: false, reason: "expired" };

    const refreshToken = randomToken(32);
    const ttlSeconds = ttlFor(Boolean(row.remember));
    const newId = await AuthSession.addRefreshToken({ sessionId: row.session_id, tokenHash: sha256(refreshToken), ttlSeconds }, connection);
    await AuthSession.markRotated(row.id, newId, connection);
    await AuthSession.touch(row.session_id, connection);
    return {
      ok: true,
      sessionPublicId: row.session_public_id,
      remember: Boolean(row.remember),
      refreshToken,
      refreshMaxAgeSeconds: Math.max(0, Math.min(ttlSeconds, Number(row.session_seconds_left) || 0)),
    };
  });
}
