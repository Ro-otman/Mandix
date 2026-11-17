/**
 * Suggestions : formulaire dans les espaces client et mandataire (/client/suggestions, /mandataire/suggestions),
 * liste et suivi réservés à l'équipe (/admin/suggestions). Accès déjà contrôlé par rôle (spaceRoutes.js) ;
 * tous les POST sont protégés par le jeton CSRF (middleware global).
 */
import { Router } from "express";
import * as suggestions from "../services/suggestionService.js";
import { renderSpace } from "../services/spaceService.js";

const router = Router();
const ctx = (req) => ({ ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) ?? null });
const formLocals = { topics: suggestions.SUGGESTION_TOPICS, messageMin: suggestions.MESSAGE_MIN, messageMax: suggestions.MESSAGE_MAX };

for (const space of ["client", "mandataire"]) {
  router.get(`/${space}/suggestions`, async (req, res) => {
    await renderSpace(req, res, "suggestions", "Suggestions", { ...formLocals, errors: {}, values: {} });
  });
  router.post(`/${space}/suggestions`, async (req, res) => {
    const result = await suggestions.submit(req.currentUser, req.body || {}, ctx(req));
    if (!result.ok) {
      res.status(422);
      return renderSpace(req, res, "suggestions", "Suggestions", { ...formLocals, errors: result.errors, values: result.values });
    }
    req.flash("success", "Merci ! Votre suggestion a bien été transmise à l'équipe Mandix.", "Suggestion envoyée");
    return res.redirect(303, `/${space}/suggestions`);
  });
}

router.get("/admin/suggestions", async (req, res) => {
  const statut = Object.hasOwn(suggestions.SUGGESTION_STATUSES, req.query.statut) ? req.query.statut : "";
  await renderSpace(req, res, "suggestions", "Suggestions", {
    statut,
    items: await suggestions.list({ statut }),
    counts: await suggestions.counts(),
    statuses: suggestions.SUGGESTION_STATUSES,
  });
});

/** Lue, traitée, ou de nouveau à lire ; retour à l'onglet d'origine. */
router.post("/admin/suggestions/:id/statut", async (req, res) => {
  const result = await suggestions.setStatus(req.currentUser, req.params.id, req.body?.statut, ctx(req));
  if (!result.ok) req.flash("danger", result.error);
  const back = Object.hasOwn(suggestions.SUGGESTION_STATUSES, req.body?.retour) ? `/admin/suggestions?statut=${req.body.retour}` : "/admin/suggestions";
  res.redirect(303, back);
});

export default router;
