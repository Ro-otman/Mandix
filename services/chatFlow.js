/**
 * Messagerie guidée (client ↔ mandataire) : aucune saisie libre, uniquement des messages préfaits
 * qui suivent le parcours d'une transaction :
 *   1. client : « Je veux faire une transaction avec votre compte X » (un choix par compte du mandataire)
 *   2. mandataire : « Quel est le montant de votre transaction ? »
 *   3. client : montant saisi (devise du compte par défaut), contrôlé en euros contre le plafond du mandataire
 *   4. mandataire : ses coordonnées de réception pour le compte choisi ; PayPal : type d'envoi
 *      (Amis et proches / Biens et services) ; virement : mode (instantané / classique)
 *   5. client : preuve de paiement (image ou PDF)
 *   6. mandataire : « Valide : C'est bon ✅ », « Rejeté : C'est pas bon ❌ » (le client renvoie une preuve),
 *      ou « En attente : Pas encore bon 🔄 » (7 jours au plus, rappel quotidien au mandataire).
 *      - Plus de 2 rejets : le client choisit Attendre (7 jours), Je laisse, ou Faire vérifier ce mandataire.
 *      - Fin des 7 jours (En attente, ou Attendre) : le client choisit Je laisse, ou Faire vérifier ce mandataire.
 *      - Faire vérifier : le mandataire est restreint et envoie les preuves du refus sous 72 h ; l'équipe Mandix
 *        lève la restriction (refus justifié) ou la prolonge de 100 jours ; la transaction est rejetée.
 *      - Je laisse : le client confirme que ce n'est pas bon ; la transaction est rejetée.
 *   7. mandataire (paiement validé) : « Par quel moyen souhaitez-vous recevoir l'argent ? »
 *   8. client : son pays, un moyen de réception disponible dans ce pays (Mobile Money, Moov Money, crypto,
 *      virement…, content/payout-methods.js) et ses informations (ex. numéro + nom et prénoms)
 *   9. mandataire : « J'ai envoyé l'argent » avec la preuve de l'envoi (image ou PDF, obligatoire)
 *  10. client : « J'ai bien reçu l'argent » ou « Je n'ai pas encore reçu l'argent » (le mandataire peut
 *      alors envoyer une nouvelle preuve du transfert)
 *  11. client, transaction validée OU rejetée : évaluation obligatoire (note de 1 à 5 + appréciation préfaite) —
 *      elle clôt la transaction ; seules les validées font monter de niveau. L'évaluation n'est PAS un message :
 *      elle est enregistrée par la plateforme (table reviews, note du mandataire) et n'est pas envoyée au mandataire,
 *      pour qui la transaction est terminée dès que le client confirme la réception.
 *
 * Ce module prépare, pour la vue, l'état initial d'une conversation (public/js/chat.js fait le reste).
 * Sécurité : côté client, les coordonnées du mandataire ne sont jamais incluses dans la page ; elles
 * n'apparaissent qu'au moment où le mandataire les envoie.
 * Démonstration : les messages transitent par le stockage local du navigateur (clé `key`).
 */
import { DEMO_MANDATAIRES } from "../content/demo-mandataires.js";
import { ACCOUNT_TYPES, DEFAULT_RECEIVE } from "../content/account-types.js";
import { countryName } from "../content/countries.js";
import { limitForTransactions, limitLabel, EUR_RATES } from "../utils/limits.js";

/** Comptes de démonstration : la cliente « AwaD » et la mandataire « Afiavi Houngbédji ». */
export const DEMO_CLIENT_KEY = "awa-dossou";
export const DEMO_PRO_SLUG = "afiavi-houngbedji";

/** Délai maximum d'un paiement « En attente » (ou de l'attente choisie par le client) : 7 jours. */
export const PENDING_MAX_DAYS = 7;
/** Au-delà de ce nombre de preuves rejetées, le client choisit : Attendre, Je laisse, Faire vérifier ce mandataire. */
export const MAX_REJECTIONS = 2;
/** Vérification du mandataire : 72 heures au plus pour envoyer les preuves du refus. */
export const VERIFICATION_HOURS = 72;
/** Restriction d'un mandataire dont le refus n'est pas justifié (ou sans preuve) : 100 jours. */
export const SANCTION_DAYS = 100;

/** Décisions du mandataire sur une preuve de paiement (mêmes libellés que les boutons). */
export const PROOF_STATUS_TEXT = {
  validated: "Valide : C'est bon ✅",
  rejected: "Rejeté : C'est pas bon ❌",
  pending: "En attente : Pas encore bon 🔄",
};

/** Choix du client après plus de 2 rejets, ou à la fin des 7 jours d'attente. */
export const CLIENT_CHOICE_TEXT = {
  wait: "J'attends : le paiement reste en cours, non validé, pendant 7 jours.",
  leave: "Je laisse : je confirme que ce n'est pas bon. La transaction s'arrête.",
  verify: "Je fais vérifier ce mandataire par l'équipe Mandix.",
};

/** Résultat de la vérification du mandataire (message de l'équipe Mandix). */
export const VERIFICATION_TEXT = {
  justified: "Vérification Mandix : les preuves du refus sont valables. La restriction du mandataire est levée. La transaction est terminée.",
  unjustified: `Vérification Mandix : les preuves du refus ne sont pas suffisantes. Le compte du mandataire est restreint pendant ${SANCTION_DAYS} jours. La transaction est terminée.`,
  no_evidence: `Vérification Mandix : aucune preuve du refus n'a été envoyée dans les ${VERIFICATION_HOURS} heures. Le compte du mandataire est restreint pendant ${SANCTION_DAYS} jours. La transaction est terminée.`,
};

const typeInfo = (slug) => ACCOUNT_TYPES.find((t) => t.slug === slug) || { slug, name: slug, logo: null, ...DEFAULT_RECEIVE };

/** Clé de conversation (identique des deux côtés) : « mandataire:client ». */
export const conversationKey = (role, otherId) => (role === "client" ? `${otherId}:${DEMO_CLIENT_KEY}` : `${DEMO_PRO_SLUG}:${otherId}`);

/** Texte d'un message préfait. Même rédaction que public/js/chat.js. */
export function eventText(event) {
  const d = event.data || {};
  switch (event.type) {
    case "request": return `Je veux faire une transaction avec votre compte ${d.accountName}.`;
    case "ask_amount": return "Quel est le montant de votre transaction ?";
    case "amount": return `Montant de la transaction : ${d.label}`; // ex. « 150 000 F CFA »
    case "receive_info": return `Voici mes coordonnées ${d.accountName} pour la transaction.${d.optionText ? ` ${d.optionText}.` : ""}`;
    case "proof": return "Preuve de paiement envoyée.";
    case "proof_status": return PROOF_STATUS_TEXT[d.status] || "";
    case "client_choice": return CLIENT_CHOICE_TEXT[d.choice] || "";
    case "refusal_proof": return "Voici les preuves du refus, pour la vérification par l'équipe Mandix.";
    case "ask_payout": return "Par quel moyen souhaitez-vous recevoir l'argent ?";
    case "credit_proof_request": return "Le délai de 7 jours est dépassé : merci de me prouver que l'argent n'est pas encore crédité sur votre compte.";
    case "credit_proof": return "Voici les preuves que l'argent n'est pas encore crédité.";
    case "credit_proof_ok": return "C'est bon, j'ai vérifié : ce n'est pas crédité.";
    case "verification_request": return "Il y a un problème avec ces preuves : je demande une vérification à Mandix.";
    case "verification_result":
      if (d.outcome) return VERIFICATION_TEXT[d.outcome] || "";
      return d.authentic // anciennes conversations
        ? "Vérification Mandix : les preuves du mandataire sont authentiques, le paiement n'est pas encore crédité. Le délai de 7 jours repart."
        : "Vérification Mandix : les preuves du mandataire ne sont pas conformes. Notre équipe prend le dossier en charge.";
    case "receipt": return d.received ? "J'ai bien reçu l'argent." : "Je n'ai pas encore reçu l'argent.";
    case "payout_info": return d.method
      ? `Envoyez l'argent par ${d.methodName} (${d.countryName}).`
      : `Envoyez l'argent sur mon compte ${d.accountName}.${d.optionText ? ` ${d.optionText}.` : ""}`;
    case "sent": return d.again ? `Voici une nouvelle preuve du transfert sur votre compte ${d.accountName}.` : `J'ai envoyé l'argent sur votre compte ${d.accountName}. Voici la capture du transfert.`;
    case "review": return `Évaluation : ${d.rating}/5 · ${d.label}. Transaction terminée.`;
    default: return "";
  }
}

/** Aperçu de la liste des conversations, du point de vue de `role`. */
export function previewOf(events, role) {
  const last = events[events.length - 1];
  if (!last) return "Nouvelle conversation";
  return (last.from === role ? "Vous : " : "") + eventText(last);
}

function accountView(account, withReceive) {
  const t = typeInfo(account.type);
  const view = {
    id: account.id, type: account.type, name: t.name, logo: t.logo, options: t.options ?? null,
    currency: account.currency, country: account.country, countryName: countryName(account.country),
  };
  if (withReceive) view.receive = account.receive || "";
  return view;
}

/**
 * État initial d'une conversation pour la vue.
 * role : "client" (la conversation est avec le mandataire otherId) ou "mandataire" (avec le client otherId).
 * proAccounts : comptes du mandataire de démonstration, avec leurs coordonnées (côté mandataire uniquement).
 */
export function threadFlow({ role, otherId, otherName, events, proAccounts, reviewed }) {
  const mandataire = DEMO_MANDATAIRES.find((m) => m.slug === (role === "client" ? otherId : DEMO_PRO_SLUG));
  const accounts = role === "client"
    ? (mandataire ? mandataire.accounts.map((a) => accountView(a, false)) : [])
    : proAccounts.map((a) => accountView(a, true));
  return {
    key: conversationKey(role, otherId),
    role,
    otherName,
    accounts,
    limitEur: limitForTransactions(mandataire ? mandataire.transactions : 0), // null : niveau 10, sans plafond
    limitLabel: limitLabel(limitForTransactions(mandataire ? mandataire.transactions : 0)),
    rates: EUR_RATES,
    pendingMaxDays: PENDING_MAX_DAYS,
    payoutTypes: ACCOUNT_TYPES.map((t) => ({ slug: t.slug, name: t.name, logo: t.logo, receiveLabel: t.receiveLabel, receivePlaceholder: t.receivePlaceholder, options: t.options ?? null })),
    events: events || [],
    reviewed: role === "client" ? reviewed || [] : [], // demandes déjà évaluées par le client
  };
}
