/**
 * Libellés français et tonalité visuelle des valeurs contrôlées de la base.
 * tone : neutral | info | success | warning | danger (classes .badge--<tone>).
 */

export const STATUS = Object.freeze({
  verification: {
    not_submitted: { label: "Non soumis", tone: "neutral" },
    pending: { label: "En attente de vérification", tone: "warning" },
    in_review: { label: "Vérification en cours", tone: "info" },
    approved: { label: "Validé", tone: "success" },
    rejected: { label: "Refusé", tone: "danger" },
    suspended: { label: "Suspendu", tone: "danger" },
  },
  request: {
    pending: { label: "En attente", tone: "warning" },
    accepted: { label: "Acceptée", tone: "info" },
    in_progress: { label: "En cours", tone: "info" },
    completed: { label: "Terminée", tone: "success" },
    refused: { label: "Refusée", tone: "danger" },
    cancelled: { label: "Annulée", tone: "neutral" },
  },
  appointment: {
    pending: { label: "À confirmer", tone: "warning" },
    confirmed: { label: "Confirmé", tone: "success" },
    completed: { label: "Effectué", tone: "neutral" },
    cancelled: { label: "Annulé", tone: "neutral" },
    no_show: { label: "Absence", tone: "danger" },
  },
  service: {
    draft: { label: "Brouillon", tone: "neutral" },
    pending: { label: "En attente de validation", tone: "warning" },
    published: { label: "Publié", tone: "success" },
    rejected: { label: "Refusé", tone: "danger" },
    suspended: { label: "Suspendu", tone: "danger" },
  },
  document: {
    pending: { label: "Reçu", tone: "warning" },
    in_review: { label: "En cours d'examen", tone: "info" },
    approved: { label: "Validé", tone: "success" },
    rejected: { label: "Refusé", tone: "danger" },
    superseded: { label: "Remplacé", tone: "neutral" },
  },
  severity: {
    low: { label: "Faible", tone: "neutral" },
    medium: { label: "Moyenne", tone: "warning" },
    high: { label: "Élevée", tone: "danger" },
  },
  alert: {
    open: { label: "À examiner", tone: "warning" },
    reviewing: { label: "En examen", tone: "info" },
    dismissed: { label: "Classée sans suite", tone: "neutral" },
    confirmed: { label: "Confirmée", tone: "danger" },
  },
  priority: {
    low: { label: "Basse", tone: "neutral" },
    normal: { label: "Normale", tone: "info" },
    high: { label: "Haute", tone: "warning" },
    critical: { label: "Critique", tone: "danger" },
  },
  account: {
    active: { label: "Actif", tone: "success" },
    suspended: { label: "Suspendu", tone: "danger" },
  },
  complaint: {
    open: { label: "Ouverte", tone: "warning" },
    assigned: { label: "Affectée", tone: "info" },
    in_progress: { label: "En traitement", tone: "info" },
    resolved: { label: "Résolue", tone: "success" },
    closed: { label: "Clôturée", tone: "neutral" },
    rejected: { label: "Rejetée", tone: "neutral" },
  },
});

export const PROFESSIONAL_TYPES = Object.freeze({
  agent_mandataire_bancaire: "Agent mandataire bancaire",
  conseiller_financier: "Conseiller financier",
  agent_microfinance: "Agent de microfinance",
  courtier: "Courtier",
  agent_monnaie_electronique: "Agent de monnaie électronique",
  autre: "Professionnel de l'accompagnement",
});

/** Retourne { label, tone } ; valeur inconnue -> libellé brut, ton neutre. */
export function status(group, value) {
  return STATUS[group]?.[value] ?? { label: String(value ?? "—"), tone: "neutral" };
}

export const professionalType = (value) => PROFESSIONAL_TYPES[value] ?? PROFESSIONAL_TYPES.autre;
