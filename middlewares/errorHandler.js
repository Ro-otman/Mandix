/**
 * Gestion centralisée des erreurs : aucun détail interne n'est envoyé au navigateur.
 */
import { HttpError } from "../utils/httpError.js";

export function notFoundHandler(req, res, next) {
  next(new HttpError(404, "La page demandée est introuvable."));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof HttpError ? err.publicMessage : "Une erreur inattendue est survenue. Réessayez plus tard.";

  if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);

  if (res.headersSent) return next(err);
  res.status(status);

  if (req.accepts(["html", "json"]) === "json") return res.json({ error: message });
  const title = status === 404 ? "Page introuvable" : "Erreur";
  return res.render("errors/error", { title, status, message }, (renderError, html) => {
    if (renderError) {
      console.error("Échec du rendu de la page d'erreur :", renderError);
      return res.type("text/plain").send(message);
    }
    res.send(html);
  });
}
