/**
 * Messagerie guidée (client ↔ mandataire) : aucune saisie libre, uniquement des messages préfaits
 * qui suivent le parcours d'une transaction :
 *   1. client : « Je veux faire une transaction avec votre compte X » (un choix par compte du mandataire)
 *   2. mandataire : « Quel est le montant de votre transaction ? »
 *   3. client : montant saisi (devise du compte par défaut), contrôlé en euros contre le plafond du mandataire
 *   4. mandataire : ses coordonnées de réception pour le compte choisi ; PayPal : type d'envoi
 *      (Amis et proches / Biens et services) ; virement : mode (instantané / classique)
 *   5. client : preuve de paiement (image ou PDF)
 *   6. décision sur la preuve (règles : PROOF_DECISIONS, rejectionChoices, expiredChoices ci-dessous) :
 *      a. le mandataire répond : « Valide : C'est bon ✅ » (étape 7), « Rejeté : C'est pas bon ❌ » (avec, toujours,
 *         une preuve du rejet pour le client : capture, document…) ou « En attente : Pas encore bon 🔄 » (7 jours au
 *         plus, rappel quotidien ; il peut ensuite valider ou rejeter) ;
 *      b. après un rejet, le client choisit :
 *           1er rejet : Attendre · Je laisse · Je renvoie ma preuve (retour à l'étape 5)
 *           2e rejet et suivants : Attendre · Je laisse · Faire vérifier ce mandataire
 *      c. Attendre : le client attend 7 jours, en espérant que le paiement arrive dans ce délai. Pendant l'attente, le
 *         mandataire peut encore valider (étape 7) ou rejeter (nouveau rejet : retour en b) ;
 *      d. fin des 7 jours sans décision : Je laisse · Je renvoie ma preuve (attente après le 1er rejet), ou
 *         Je laisse · Faire vérifier ce mandataire (paiement « En attente », ou attente après le 2e rejet) ;
 *      e. Faire vérifier : le mandataire est restreint et envoie les preuves du refus sous 72 h ; l'équipe Mandix lève
 *         la restriction (refus justifié) ou la prolonge de 100 jours ; la transaction est rejetée ;
 *      f. Je laisse : le client confirme que ce n'est pas bon ; la transaction est rejetée.
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
/**
 * Rejets d'une même transaction : après le 1er, le client peut renvoyer sa preuve (Attendre, Je laisse, Je renvoie
 * ma preuve) ; au 2e, « Je renvoie ma preuve » laisse la place à « Faire vérifier ce mandataire ».
 */
export const MAX_REJECTIONS = 2;
/** Choix proposés au client après le rejet n° `rejections`. */
export const rejectionChoices = (rejections) => (rejections >= MAX_REJECTIONS ? ["wait", "leave", "verify"] : ["wait", "leave", "resend"]);
/**
 * Fin des 7 jours sans validation : Je laisse, et Je renvoie ma preuve (attente choisie après le 1er rejet)
 * ou Faire vérifier ce mandataire (paiement laissé « En attente » par le mandataire, ou attente après le 2e rejet).
 */
export const expiredChoices = (status, rejections) =>
  (status === "client_waiting" && rejections < MAX_REJECTIONS ? ["leave", "resend"] : ["leave", "verify"]);
/** Libellés des boutons de choix du client. */
export const CHOICE_LABELS = { wait: "Attendre", leave: "Je laisse", resend: "Je renvoie ma preuve", verify: "Faire vérifier ce mandataire" };
/** « Attendre, Je laisse, ou Je renvoie ma preuve » */
export const choiceList = (keys) => {
  const labels = keys.map((k) => CHOICE_LABELS[k]);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")}, ou ${labels[labels.length - 1]}` : labels.join("");
};
/** Vérification du mandataire : 72 heures au plus pour envoyer les preuves du refus. */
export const VERIFICATION_HOURS = 72;
/** Restriction d'un mandataire dont le refus n'est pas justifié (ou sans preuve) : 100 jours. */
export const SANCTION_DAYS = 100;

/**
 * Décisions possibles du mandataire sur la preuve de paiement, selon l'étape (statut de la transaction) :
 *  - preuve reçue : Valide, Rejeté ou En attente ;
 *  - paiement « En attente » (7 jours au plus) : Valide ou Rejeté ;
 *  - le client attend 7 jours après un rejet : Valide ou Rejeté.
 * Source unique des règles : le serveur les applique et les transmet au panneau de messagerie (flow.proofDecisions).
 */
export const PROOF_DECISIONS = Object.freeze({
  proof_review: Object.freeze(["validated", "rejected", "pending"]),
  proof_pending: Object.freeze(["validated", "rejected"]),
  client_waiting: Object.freeze(["validated", "rejected"]),
});
/** Étapes où la décision `decision` est possible. */
export const statusesAllowing = (decision) => Object.keys(PROOF_DECISIONS).filter((status) => PROOF_DECISIONS[status].includes(decision));

/** Décisions du mandataire sur une preuve de paiement (mêmes libellés que les boutons). */
export const PROOF_STATUS_TEXT = {
  validated: "Valide : C'est bon ✅",
  rejected: "Rejeté : C'est pas bon ❌",
  pending: "En attente : Pas encore bon 🔄",
};

/** Choix du client après un rejet, ou à la fin des 7 jours d'attente. */
export const CLIENT_CHOICE_TEXT = {
  wait: "J'attends 7 jours, en espérant que le paiement arrive dans ce délai.",
  leave: "Je laisse : je confirme que ce n'est pas bon. La transaction s'arrête.",
  resend: "Je renvoie ma preuve de paiement.",
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
