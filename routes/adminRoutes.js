/**
 * Espace administrateur, données réelles (accès réservé aux administrateurs connectés : spaceRoutes.js).
 * Vue d'ensemble, mandataires (fiche, suspension / réactivation), clients (tri, recherche, suspension),
 * vérifications des preuves de non-crédit (décision publiée dans la conversation).
 */
import { Router } from "express";
import * as admin from "../services/adminService.js";
import * as messaging from "../services/messagingService.js";
import { renderSpace } from "../services/spaceService.js";
import { limitLabelFor, tierFor } from "../utils/limits.js";
import { CERTIFICATION_THRESHOLD } from "../utils/badges.js";
import { accountTypeName } from "../content/account-types.js";
import { PENDING_MAX_DAYS } from "../services/chatFlow.js";
import { notFound } from "../utils/httpError.js";

const router = Router();
const ctx = (req) => ({ ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) ?? null });
const locals = { limitFor: limitLabelFor, levelFor: (n) => tierFor(n).level, certificationThreshold: CERTIFICATION_THRESHOLD, typeName: accountTypeName };
const search = (value) => (typeof value === "string" ? value.trim().slice(0, 80) : "");

router.get("/admin", (req, res) => res.redirect("/admin/dashboard"));

router.get("/admin/dashboard", async (req, res) => {
  await renderSpace(req, res, "dashboard", "Vue d'ensemble", { ...locals, ...(await admin.dashboard()) });
});

router.get("/admin/mandataires", async (req, res) => {
  const statut = ["active", "suspended"].includes(req.query.statut) ? req.query.statut : "";
  const q = search(req.query.q);
  const all = await admin.listMandataires({});
  const mandataires = statut || q ? await admin.listMandataires({ statut, q }) : all;
  await renderSpace(req, res, "mandataires", "Mandataires", { ...locals, statut, q, all, mandataires });
});

router.get("/admin/mandataires/:slug", async (req, res, next) => {
  const detail = await admin.mandataireDetail(req.params.slug);
  if (!detail) return next(notFound("Mandataire introuvable."));
  await renderSpace(req, res, "mandataire-detail", "Fiche mandataire", { ...locals, ...detail });
});

router.get("/admin/clients", async (req, res) => {
  const tri = Object.hasOwn(admin.CLIENT_SORTS, req.query.tri) ? req.query.tri : "transactions";
  const q = search(req.query.q);
  await renderSpace(req, res, "clients", "Clients", {
    clients: await admin.listClients({ tri, q }), tri, q,
    sorts: Object.entries(admin.CLIENT_SORTS).map(([key, s]) => ({ key, label: s.label })),
  });
});

/** Suspension / réactivation d'un client ou d'un mandataire, puis retour à la page d'origine. */
router.post("/admin/comptes/:id/:action", async (req, res) => {
  const action = { suspendre: "suspend", reactiver: "reactivate" }[req.params.action];
  const result = await admin.setAccountStatus(req.currentUser, req.params.id, action, ctx(req));
  if (!result.ok) req.flash("danger", result.error);
  else req.flash("success", `${result.pseudo} : compte ${result.status === "suspended" ? "suspendu, sessions fermées" : "réactivé"}.`, result.status === "suspended" ? "Compte suspendu" : "Compte réactivé");
  const back = typeof req.body?.retour === "string" && /^\/admin\/[a-z0-9/?=&_-]{0,120}$/i.test(req.body.retour) ? req.body.retour : "/admin/dashboard";
  res.redirect(303, back);
});

router.get("/admin/verifications", async (req, res) => {
  await renderSpace(req, res, "verifications", "Vérifications", {
    requests: await admin.listVerifications(),
    names: { pros: {}, clients: {} },
    pendingMaxDays: PENDING_MAX_DAYS,
  });
});

router.post("/admin/verifications/:ref/decision", async (req, res) => {
  try {
    const result = await messaging.decideVerification(req.currentUser, req.params.ref, req.body?.decision, ctx(req));
    req.flash("success", result.closedOnly
      ? "Demande close (la transaction n'attendait plus de vérification)."
      : "Décision publiée dans la conversation : le client et le mandataire sont notifiés.", "Décision enregistrée");
  } catch (error) {
    if (!(error instanceof messaging.MessagingError)) throw error;
    req.flash("danger", error.publicMessage);
  }
  res.redirect(303, "/admin/verifications");
});

export default router;
