/**
 * Espace client, données réelles (accès réservé aux clients connectés : spaceRoutes.js).
 * Accueil (recherche de mandataires), fiche d'un mandataire, profil (pseudo), paramètres (mot de passe,
 * suppression du compte). Messages et notifications : routes/messagingRoutes.js.
 */
import { Router } from "express";
import * as marketplace from "../services/marketplaceService.js";
import * as users from "../services/userService.js";
import { renderSpace, userAvatar } from "../services/spaceService.js";
import { clearAuthCookies } from "../services/tokenService.js";
import { ACCOUNT_TYPES } from "../content/account-types.js";
import { defaultAvatarSpec } from "../utils/avatar.js";
import { notFound } from "../utils/httpError.js";
import { avatarSvg } from "../utils/avatar.js";

const router = Router();
const ctx = (req) => ({ ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) ?? null });

router.get("/client", (req, res) => res.redirect("/client/dashboard"));

// Accueil du client : barre de recherche et mandataires disponibles (4 critères de recherche).
router.get("/client/dashboard", async (req, res) => {
  const { pays, type, nom, somme } = marketplace.readFilters(req.query);
  const filters = { pays, type, nom, somme, tri: "pertinence" };
  await renderSpace(req, res, "dashboard", "Accueil", {
    filters,
    results: await marketplace.search(filters),
    countries: marketplace.listCountries(),
    accountTypes: ACCOUNT_TYPES,
    activeFilterCount: ["pays", "type", "nom", "somme"].filter((k) => filters[k]).length,
  });
});

// Fiche d'un mandataire (page et panneau latéral)
router.get("/client/mandataires/:slug", async (req, res, next) => {
  const profile = await marketplace.getProfile(req.params.slug);
  if (!profile) return next(notFound("Ce mandataire n'est pas disponible."));
  await renderSpace(req, res, "mandataire", "Mandataire", { profile });
});
router.get("/client/panneau/mandataires/:slug", async (req, res, next) => {
  if (req.get("X-Mandix-Panel") !== "1") return res.redirect(`/client/mandataires/${encodeURIComponent(req.params.slug)}`);
  const profile = await marketplace.getProfile(req.params.slug);
  if (!profile) return next(notFound());
  res.set({ "Cache-Control": "no-store", Vary: "X-Mandix-Panel" });
  res.render("client/panel-profile", { layout: false, avatarSvg, profile });
});

/* ------------------------------------------------------------------ Profil */

const clientView = (user) => ({ pseudo: user.pseudo, email: user.email, memberSince: user.memberSince, avatar: defaultAvatarSpec(user.publicId) });

router.get("/client/profil", async (req, res) => {
  await renderSpace(req, res, "profile", "Mon profil", { client: clientView(req.currentUser) });
});
router.get("/client/panneau/profil", (req, res) => {
  if (req.get("X-Mandix-Panel") !== "1") return res.redirect("/client/profil");
  res.set({ "Cache-Control": "no-store", Vary: "X-Mandix-Panel" });
  res.render("client/panel-profile-me", { layout: false, avatarSvg, client: clientView(req.currentUser), userAvatar });
});
router.post("/client/profil", async (req, res) => {
  const result = await users.changePseudo(req.currentUser, req.body?.pseudo, ctx(req));
  if (!result.ok) req.flash("danger", result.error);
  else req.flash("success", "Votre pseudo est enregistré.", "Profil mis à jour");
  res.redirect(303, "/client/profil");
});

/* ------------------------------------------------------------------ Paramètres */

router.get("/client/parametres", async (req, res) => {
  await renderSpace(req, res, "settings", "Paramètres", { client: clientView(req.currentUser) });
});

router.post("/client/parametres/mot-de-passe", async (req, res) => {
  const result = await users.changePassword(req.currentUser, req.auth, {
    current: req.body?.current, password: req.body?.password, passwordConfirm: req.body?.passwordConfirm,
  }, ctx(req));
  if (!result.ok) req.flash("danger", result.error);
  else req.flash("success", "Vos autres appareils ont été déconnectés.", "Mot de passe modifié");
  res.redirect(303, "/client/parametres");
});

router.post("/client/compte/supprimer", async (req, res) => {
  try {
    await users.deleteAccount(req.currentUser, ctx(req));
  } catch (error) {
    if (error.code !== "OPEN_TRANSACTION") throw error;
    req.flash("warning", "Terminez d'abord votre transaction en cours (ou attendez sa clôture) avant de supprimer votre compte.");
    return res.redirect(303, "/client/parametres");
  }
  clearAuthCookies(res, "client"); // une session mandataire ouverte dans le même navigateur reste ouverte
  req.flash("info", "Votre compte a été supprimé et vos données personnelles anonymisées.", "Compte supprimé");
  res.redirect(303, "/");
});

export default router;
