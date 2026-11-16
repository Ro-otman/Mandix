/**
 * Authentification : pages (connexion, inscriptions, confirmation d'e-mail, mot de passe oublié,
 * réinitialisation) et actions (formulaires POST, déconnexion). La logique est dans services/authService.js ;
 * ce contrôleur valide les entrées, appelle le service, pose les cookies et choisit la page à afficher.
 *
 * Chaque page a son propre panneau visuel (photo différente, accroche, avantages) et son lien
 * de bascule en haut à droite (« Créer un compte » ↔ « Se connecter »).
 */
import config from "../config/app.js";
import * as authService from "../services/authService.js";
import { setAuthCookies, clearAuthCookies } from "../services/tokenService.js";
import { readValidation } from "../validators/authValidators.js";
import { ROLE_HOME } from "../middlewares/authorize.js";
import { requestedSpace } from "../middlewares/authenticate.js";

const TO_LOGIN = { text: "Déjà inscrit ?", label: "Se connecter", href: "/connexion" };

const ASIDES = {
  login: {
    photo: "auth-connexion",
    pill: "Mise en relation encadrée",
    chip: { icon: "lock", title: "Espace sécurisé", text: "Aucun code bancaire demandé" },
    kicker: "Bon retour",
    title: "Vos démarches financières, entre de bonnes mains.",
    perks: [
      ["message-circle", "Vos conversations avec les mandataires"],
      ["globe", "Des mandataires dans de nombreux pays"],
      ["star", "Vos avis sur les mandataires"],
    ],
  },
  register: {
    photo: "auth-inscription",
    pill: "Mandataires de confiance",
    chip: { icon: "messages-square", title: "Messagerie guidée", text: "Chaque étape suivie, preuves à l'appui" },
    kicker: "Pourquoi Mandix",
    title: "D'un compte à l'autre, avec un mandataire de confiance.",
    perks: [
      ["wallet", "PayPal, Wise, Western Union, virement, crypto…"],
      ["file-check", "Une preuve à chaque étape de la transaction"],
      ["scale", "L'équipe Mandix en cas de litige"],
    ],
  },
  pro: {
    photo: "auth-pro",
    pill: "Espace professionnel",
    chip: { icon: "trending-up", title: "Niveaux", text: "Votre plafond grandit avec vos transactions" },
    kicker: "Pour les mandataires",
    title: "Publiez vos comptes, recevez des demandes du monde entier.",
    perks: [
      ["wallet", "Vos comptes publiés dès leur ajout"],
      ["messages-square", "Une messagerie guidée pour chaque transaction"],
      ["award", "Statistiques, niveaux et certification à 1 000 transactions"],
    ],
  },
  secure: {
    illustration: "securite",
    pill: "Sécurité du compte",
    chip: null,
    kicker: "Votre sécurité",
    title: "Votre compte reste protégé.",
    perks: [
      ["key-round", "Lien à usage unique"],
      ["clock-3", "Expiration automatique"],
      ["lock", "Connexion sécurisée"],
    ],
  },
};

/* ------------------------------------------------------------------ Outils */

const PENDING_COOKIE = `${config.auth.cookiePrefix}mandix.pending`;
const pendingCookieOptions = { httpOnly: true, secure: config.isProduction, sameSite: "lax", path: "/", signed: true, maxAge: 60 * 60 * 1000 };

const context = (req) => ({ ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) ?? null });

/** Masque une adresse pour l'affichage : « a•••@gmail.com ». */
function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return "";
  return `${local[0]}${"•".repeat(Math.min(Math.max(local.length - 1, 3), 6))}@${domain}`;
}

/**
 * Page à rouvrir après la connexion : chemin interne uniquement (jamais d'URL externe ni « //hôte »),
 * et seulement dans l'espace du rôle de l'utilisateur.
 */
function safeNext(value) {
  if (typeof value !== "string" || value.length > 300) return null;
  if (!/^\/(client|mandataire|admin)(\/[A-Za-z0-9/_?=&%.-]*)?$/.test(value)) return null;
  if (value.startsWith("/mandataire/inscription")) return null;
  return value;
}
const nextFor = (user, next) => (next && next.split(/[/?]/)[1] === user.role ? next : ROLE_HOME[user.role]);

function renderAuth(res, view, title, aside, topLink, { status = 200, hideFooter = false, ...locals } = {}) {
  res.set("Cache-Control", "no-store");
  return res.status(status).render(`auth/${view}`, {
    layout: "layouts/auth", title, aside: ASIDES[aside], topLink, hideFooter,
    errors: {}, values: {}, formError: null, ...locals,
  });
}

/* ------------------------------------------------------------------ Connexion */

const renderLogin = (res, locals = {}) =>
  renderAuth(res, "login", "Connexion", "login", null, { hideFooter: true, nextPath: null, proSpace: false, openSpaces: [], ...locals });

/** Connexion à l'espace mandataire (« /connexion?espace=mandataire »), ouverte par « Devenir prestataire ». */
const isProSpace = (value) => value === "mandataire";
/** Autres espaces déjà connectés dans ce navigateur : leur onglet mène directement à l'espace. */
const openSpacesOf = (req, current) => (req.authSpaces || []).filter((space) => space !== current);
const LOGIN_PATH = { mandataire: "/connexion?espace=mandataire" };
const loginPathFor = (role) => LOGIN_PATH[role] || "/connexion";

/**
 * Bouton « Devenir prestataire » : si une session mandataire est ouverte dans ce navigateur, son espace ;
 * sinon (visiteur, ou seulement connecté en client) la connexion à l'espace mandataire.
 */
export function enterProviderSpace(req, res) {
  res.set("Cache-Control", "no-store"); // la destination dépend des sessions du navigateur
  if ((req.authSpaces || []).includes("mandataire")) return res.redirect(ROLE_HOME.mandataire);
  return res.redirect("/connexion?espace=mandataire");
}

export function showLogin(req, res) {
  const nextPath = safeNext(req.query.suite);
  // Onglet « Professionnel » : demandé explicitement, ou page de l'espace mandataire à rouvrir après connexion.
  const proSpace = isProSpace(req.query.espace) || Boolean(nextPath?.startsWith("/mandataire"));
  return renderLogin(res, { nextPath, proSpace, openSpaces: openSpacesOf(req, proSpace ? "mandataire" : "client") });
}

/**
 * Connexion. Elle ouvre une session pour l'espace du compte (cookies de cet espace) sans toucher aux sessions
 * des autres espaces : on peut être connecté en client dans un onglet et en mandataire dans un autre.
 */
export async function login(req, res) {
  const { errors, data } = readValidation(req);
  const proSpace = isProSpace(data.espace);
  const page = { nextPath: safeNext(data.suite), proSpace, openSpaces: openSpacesOf(req, proSpace ? "mandataire" : "client") };
  const values = { email: typeof data.email === "string" ? data.email : "" };
  if (errors) return renderLogin(res, { status: 422, errors, values, ...page });

  const space = ["client", "mandataire"].includes(data.espace) ? data.espace : null;
  const result = await authService.login({ email: data.email, password: data.password, remember: data.remember === "on", space }, context(req));
  if (!result.ok) {
    if (result.code === "unverified") res.cookie(PENDING_COOKIE, data.email, pendingCookieOptions);
    return renderLogin(res, {
      status: result.code === "locked" ? 429 : result.code === "invalid" ? 401 : 403,
      formError: result.message, unverified: result.code === "unverified", values, ...page,
    });
  }
  setAuthCookies(res, result.user.role, result.tokens);
  return res.redirect(303, nextFor(result.user, page.nextPath));
}

/* ------------------------------------------------------------------ Inscription */

const REGISTER_PAGES = {
  client: { view: "register", title: "Créer un compte", aside: "register" },
  mandataire: { view: "register-pro", title: "Inscription mandataire", aside: "pro" },
};
const renderRegister = (res, role, locals = {}) => {
  const page = REGISTER_PAGES[role];
  return renderAuth(res, page.view, page.title, page.aside, TO_LOGIN, { hideFooter: true, ...locals });
};

export const showRegister = (req, res) => renderRegister(res, "client");
export const showRegisterPro = (req, res) => renderRegister(res, "mandataire");

const registerAs = (role) => async (req, res) => {
  const { errors, data } = readValidation(req);
  const values = { pseudo: typeof data.pseudo === "string" ? data.pseudo : "", email: typeof data.email === "string" ? data.email : "" };
  if (errors) return renderRegister(res, role, { status: 422, errors, values });

  const result = await authService.register({ role, pseudo: data.pseudo, email: data.email, password: data.password }, context(req));
  if (!result.ok) return renderRegister(res, role, { status: 422, errors: result.errors, values });

  // Une session ouverte dans un autre espace (ex. client) reste ouverte : chaque espace a la sienne.
  res.cookie(PENDING_COOKIE, data.email, pendingCookieOptions);
  return res.redirect(303, "/verification-email");
};
export const register = registerAs("client");
export const registerPro = registerAs("mandataire");

/* ------------------------------------------------------------------ Confirmation de l'adresse e-mail */

const renderVerify = (req, res, locals = {}) => {
  const pending = req.signedCookies?.[PENDING_COOKIE];
  return renderAuth(res, "verify-email", "Confirmez votre adresse e-mail", "secure", TO_LOGIN, {
    hideFooter: true,
    maskedEmail: typeof pending === "string" ? maskEmail(pending) : "",
    hasPendingEmail: typeof pending === "string",
    state: "sent",
    ...locals,
  });
};

export const showVerifyEmail = (req, res) => renderVerify(req, res);

export async function confirmEmail(req, res) {
  const result = await authService.verifyEmail(req.params.jeton, context(req));
  if (!result.ok) return renderVerify(req, res, { status: 400, state: "invalid" });
  res.clearCookie(PENDING_COOKIE, { ...pendingCookieOptions, maxAge: undefined });
  req.flash("success", result.already ? "Votre adresse e-mail est déjà confirmée. Connectez-vous." : "Votre adresse e-mail est confirmée et votre compte est actif. Connectez-vous !", result.already ? "Déjà confirmée" : "Bienvenue à bord !");
  return res.redirect(303, loginPathFor(result.role)); // mandataire : onglet Professionnel
}

/** « Renvoyer l'e-mail » sans ressaisie : reprend l'adresse mémorisée (cookie signé) avant la validation. */
export function usePendingEmail(req, res, next) {
  const pending = req.signedCookies?.[PENDING_COOKIE];
  if (req.body && !req.body.email && typeof pending === "string") req.body.email = pending;
  next();
}

export async function resendVerification(req, res) {
  const { errors, data } = readValidation(req);
  if (errors) return renderVerify(req, res, { status: 422, errors, values: { email: typeof data.email === "string" ? data.email : "" } });
  await authService.resendVerification(data.email);
  res.cookie(PENDING_COOKIE, data.email, pendingCookieOptions);
  req.flash("info", "Si un compte attend une confirmation pour cette adresse, un nouveau lien vient d'être envoyé (un envoi par minute au maximum).", "Lien en route");
  return res.redirect(303, "/verification-email");
}

/* ------------------------------------------------------------------ Mot de passe oublié */

const renderForgot = (res, locals = {}) => renderAuth(res, "forgot", "Mot de passe oublié", "secure", TO_LOGIN, { hideFooter: true, ...locals });

export const showForgot = (req, res) => renderForgot(res);

export async function forgot(req, res) {
  const { errors, data } = readValidation(req);
  if (errors) return renderForgot(res, { status: 422, errors, values: { email: typeof data.email === "string" ? data.email : "" } });
  await authService.requestPasswordReset(data.email);
  // Réponse identique qu'un compte existe ou non.
  return renderForgot(res, { sent: true, maskedEmail: maskEmail(data.email) });
}

/* ------------------------------------------------------------------ Réinitialisation */

const renderReset = (req, res, locals = {}) =>
  renderAuth(res, "reset", "Nouveau mot de passe", "secure", TO_LOGIN, { hideFooter: true, token: req.params.jeton, valid: true, ...locals });

export async function showReset(req, res) {
  const valid = await authService.isResetTokenValid(req.params.jeton);
  return renderReset(req, res, { valid, status: valid ? 200 : 400 });
}

export async function resetPassword(req, res) {
  const { errors, data } = readValidation(req);
  if (errors) return renderReset(req, res, { status: 422, errors });
  const result = await authService.resetPassword(req.params.jeton, data.password, context(req));
  if (!result.ok) {
    if (result.code === "invalid") return renderReset(req, res, { status: 400, valid: false });
    return renderReset(req, res, { status: 422, errors: result.errors });
  }
  clearAuthCookies(res, result.role); // sessions de ce compte révoquées ; celles d'un autre compte du navigateur restent
  req.flash("success", "Toutes vos sessions ont été fermées : connectez-vous avec votre nouveau mot de passe.", "Mot de passe modifié");
  return res.redirect(303, loginPathFor(result.role));
}

/* ------------------------------------------------------------------ Déconnexion */

/** Ferme la session de l'espace d'où vient la demande (champ « espace ») ; les autres espaces restent connectés. */
export async function logout(req, res) {
  const space = req.currentUser?.role ?? requestedSpace(req);
  await authService.logout(req.auth, req.currentUser, context(req));
  if (space) clearAuthCookies(res, space);
  req.flash("info", "Vous êtes bien déconnecté. Merci de votre visite.", "À bientôt !");
  return res.redirect(303, loginPathFor(space));
}

export async function logoutEverywhere(req, res) {
  const closed = await authService.logoutEverywhere(req.currentUser, context(req));
  clearAuthCookies(res, req.currentUser.role);
  req.flash("info", `Vous êtes déconnecté de tous vos appareils (${closed} session${closed > 1 ? "s" : ""} fermée${closed > 1 ? "s" : ""}).`, "À bientôt !");
  return res.redirect(303, loginPathFor(req.currentUser.role));
}
