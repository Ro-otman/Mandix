/**
 * Erreur HTTP « attendue ». Seul `publicMessage` est montré à l'utilisateur ;
 * les détails internes restent dans les journaux serveur.
 */
export class HttpError extends Error {
  constructor(status, publicMessage, { cause } = {}) {
    super(publicMessage, { cause });
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export const badRequest = (msg = "Requête invalide.") => new HttpError(400, msg);
export const forbidden = (msg = "Vous n'avez pas accès à cette ressource.") => new HttpError(403, msg);
export const notFound = (msg = "La page demandée est introuvable.") => new HttpError(404, msg);
export const conflict = (msg = "Cette action entre en conflit avec l'état actuel.") => new HttpError(409, msg);
