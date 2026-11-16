/**
 * Authentification : inscription (client, mandataire), confirmation de l'adresse e-mail, connexion,
 * mot de passe oublié, réinitialisation, déconnexion.
 * Tous les POST sont protégés par le jeton CSRF (middleware global) et limités en débit.
 */
import { Router } from "express";
import * as auth from "../controllers/authController.js";
import { requireAuth, requireGuest } from "../middlewares/authenticate.js";
import { authLimiter, emailLimiter } from "../middlewares/rateLimiter.js";
import { registerRules, loginRules, emailOnlyRules, resetRules } from "../validators/authValidators.js";

const router = Router();

// Connexion, par onglet (?espace=mandataire pour l'onglet Professionnel). Une session par espace : déjà connecté
// à l'espace demandé → retour à cet espace ; connecté seulement à un autre espace → la connexion s'affiche.
router.get("/connexion", requireGuest, auth.showLogin);
router.post("/connexion", authLimiter, requireGuest, loginRules, auth.login);

// Bouton « Devenir prestataire » : espace mandataire si connecté en mandataire, sinon connexion mandataire
router.get("/espace-mandataire", auth.enterProviderSpace);

// Inscriptions
router.get("/inscription", requireGuest, auth.showRegister);
router.post("/inscription", authLimiter, requireGuest, registerRules, auth.register);
// Session mandataire ouverte : retour à son espace. Une session client ouverte n'empêche pas l'inscription.
router.get("/mandataire/inscription", requireGuest, auth.showRegisterPro);
router.post("/mandataire/inscription", authLimiter, requireGuest, registerRules, auth.registerPro);

// Confirmation de l'adresse e-mail
router.get("/verification-email", auth.showVerifyEmail);
router.post("/verification-email/renvoyer", emailLimiter, auth.usePendingEmail, emailOnlyRules, auth.resendVerification);
router.get("/verification-email/:jeton", auth.confirmEmail);

// Mot de passe oublié et réinitialisation
router.get("/mot-de-passe-oublie", auth.showForgot);
router.post("/mot-de-passe-oublie", emailLimiter, emailOnlyRules, auth.forgot);
router.get("/reinitialisation/:jeton", auth.showReset);
router.post("/reinitialisation/:jeton", authLimiter, resetRules, auth.resetPassword);

// Déconnexion (POST uniquement : un lien ou une image ne peut pas déconnecter quelqu'un)
router.post("/deconnexion", auth.logout);
router.post("/deconnexion/partout", requireAuth, auth.logoutEverywhere);

export default router;
