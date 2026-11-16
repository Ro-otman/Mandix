/**
 * Contrôle d'accès des espaces connectés : chaque espace est réservé à son rôle.
 *   /client/*      → clients connectés
 *   /mandataire/*  → mandataires connectés (sauf /mandataire/inscription, servie avant par authRoutes)
 *   /admin/*       → administrateurs connectés
 * Un visiteur non connecté est renvoyé vers la connexion (puis ramené à la page demandée) ;
 * un utilisateur connecté d'un autre rôle reçoit une erreur 403.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/authenticate.js";
import { requireRole, ROLES } from "../middlewares/authorize.js";

const router = Router();

const noStore = (req, res, next) => {
  res.set("Cache-Control", "no-store"); // pages personnelles : jamais en cache (bouton Retour après déconnexion)
  next();
};

router.use("/client", noStore, requireAuth, requireRole(ROLES.CLIENT));
router.use("/mandataire", noStore, requireAuth, requireRole(ROLES.MANDATAIRE));
router.use("/admin", noStore, requireAuth, requireRole(ROLES.ADMIN));

export default router;
