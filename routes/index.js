/**
 * Point de montage unique des routeurs. Toutes les pages des espaces sont branchées sur la base de données.
 */
import { Router } from "express";
import config from "../config/app.js";
import publicRoutes from "./publicRoutes.js";
import authRoutes from "./authRoutes.js";
import spaceRoutes from "./spaceRoutes.js";
import mandataireRoutes from "./mandataireRoutes.js";
import messagingRoutes from "./messagingRoutes.js";
import clientRoutes from "./clientRoutes.js";
import adminRoutes from "./adminRoutes.js";
import suggestionRoutes from "./suggestionRoutes.js";
import { loadMandataire } from "../middlewares/profile.js";
import devRoutes from "./devRoutes.js";

const router = Router();

router.use(loadMandataire);
router.use("/", publicRoutes);
router.use("/", authRoutes);
if (!config.isProduction) router.use("/dev", devRoutes);
// Espaces connectés : accès réservé au rôle (connexion obligatoire), puis pages de chaque espace.
router.use(spaceRoutes);
router.use(mandataireRoutes);
router.use(clientRoutes);
router.use(adminRoutes);
router.use(suggestionRoutes);
router.use(messagingRoutes);

export default router;
