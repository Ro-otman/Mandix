/**
 * Messagerie guidée (client ↔ mandataire) : aucune saisie libre, uniquement des messages préfaits
 * qui suivent le parcours d'une transaction :
 *   1. client : « Je veux faire une transaction avec votre compte X » (un choix par compte du mandataire)
 *   2. mandataire : « Quel est le montant de votre transaction ? »
 *   3. client : montant saisi (devise du compte par défaut), contrôlé en euros contre le plafond du mandataire
 *   4. mandataire : ses coordonnées de réception pour le compte choisi ; PayPal : type d'envoi
 *      (Amis et proches / Biens et services) ; virement : mode (instantané / classique)
 *   5. client : preuve de paiement (image ou PDF)
 *   6. mandataire : Validé / Rejeté (le client renvoie une preuve) / En attente (paiement pas encore crédité)
 *      En attente : délai maximum de 7 jours. Au-delà, le client peut demander une preuve que l'argent
 *      n'est pas crédité ; le mandataire envoie ses captures ; le client répond « C'est bon, j'ai vérifié :
 *      ce n'est pas crédité » (le délai repart) ou « Il y a un problème avec ces preuves : demander une
 *      vérification » -> l'équipe Mandix vérifie (espace admin, Vérifications) et notifie le client.
 *      Le mandataire peut valider à tout moment si le paiement arrive.
 *   7. client (paiement validé) : le compte sur lequel recevoir l'argent, avec l'option du compte s'il en a une
 *      (PayPal : Amis et proches / Biens et services ; virement : instantané / classique, voir ACCOUNT_OPTIONS)
 *   8. mandataire : « J'ai envoyé l'argent » avec la capture du transfert (image ou PDF, obligatoire)
 *   9. client : « J'ai bien reçu l'argent » ou « Je n'ai pas encore reçu l'argent » (le mandataire peut
 *      alors envoyer une nouvelle preuve du transfert)
 *  10. client (argent reçu) : évaluation obligatoire (note de 1 à 5 + appréciation préfaite) — elle clôt la
 *      transaction ; aucune nouvelle transaction ne peut commencer avant. L'évaluation n'est PAS un message :
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

/** Délai maximum d'un paiement « En attente » avant que le client puisse demander une preuve de non-crédit. */
export const PENDING_MAX_DAYS = 7;

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
    case "proof_status": return { pending: "En attente : le paiement n'est pas encore crédité sur mon compte.", validated: "Validé : paiement bien reçu.", rejected: "Rejeté : merci d'envoyer une nouvelle preuve." }[d.status] || "";
    case "credit_proof_request": return "Le délai de 7 jours est dépassé : merci de me prouver que l'argent n'est pas encore crédité sur votre compte.";
    case "credit_proof": return "Voici les preuves que l'argent n'est pas encore crédité.";
    case "credit_proof_ok": return "C'est bon, j'ai vérifié : ce n'est pas crédité.";
    case "verification_request": return "Il y a un problème avec ces preuves : je demande une vérification à Mandix.";
    case "verification_result": return d.authentic
      ? "Vérification Mandix : les preuves du mandataire sont authentiques, le paiement n'est pas encore crédité. Le délai de 7 jours repart."
      : "Vérification Mandix : les preuves du mandataire ne sont pas conformes. Notre équipe prend le dossier en charge.";
    case "receipt": return d.received ? "J'ai bien reçu l'argent." : "Je n'ai pas encore reçu l'argent.";
    case "payout_info": return `Envoyez l'argent sur mon compte ${d.accountName}.${d.optionText ? ` ${d.optionText}.` : ""}`;
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
