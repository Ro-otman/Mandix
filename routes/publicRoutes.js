import { Router } from "express";
import { showHome, showAbout, showLegal, showHowItWorks, showBecomeProvider, showHelp } from "../controllers/homeController.js";
import { listMandataires, showMandataire, showMandatairePanel } from "../controllers/marketplaceController.js";

const router = Router();

router.get("/", showHome);
router.get("/a-propos", showAbout);
router.get("/conditions-utilisation", showLegal("conditions-utilisation"));
router.get("/confidentialite", showLegal("confidentialite"));

// Pages d'information
router.get("/comment-ca-marche", showHowItWorks);
router.get("/devenir-mandataire", showBecomeProvider);
router.get("/aide", showHelp);

// Marketplace
router.get("/mandataires", listMandataires);
router.get("/mandataires/:slug", showMandataire);
router.get("/panneau/mandataires/:slug", showMandatairePanel);

export default router;
