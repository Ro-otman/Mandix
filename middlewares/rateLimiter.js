/**
 * Limiteurs de débit. Le verrouillage par compte (échecs de connexion répétés)
 * est complémentaire et géré via la table login_attempts (Phase 3).
 */
import rateLimit from "express-rate-limit";

const handler = (req, res) => {
  res.status(429).render("errors/error", {
    title: "Trop de tentatives",
    status: 429,
    message: "Trop de tentatives depuis votre connexion. Patientez quelques minutes avant de réessayer.",
  });
};

/** Limite globale, large, contre les abus. */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler,
});

/** Connexion, inscription, mot de passe oublié : strict. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler,
});

/** Téléversements de documents. */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler,
});

/**
 * Envois d'e-mails déclenchés par un visiteur (mot de passe oublié, renvoi du lien de confirmation) :
 * chaque envoi compte, même réussi (la réponse est toujours la même, qu'un compte existe ou non).
 */
export const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler,
});
