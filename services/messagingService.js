/**
 * Messagerie guidée en temps réel (client ↔ mandataire), côté serveur.
 *
 * Le serveur est seul juge du parcours : chaque action est revalidée ici (bon rôle, bonne étape, montant sous le
 * plafond, option attendue, pièce jointe appartenant à la transaction…), quel que soit ce que le navigateur envoie.
 * L'étape en cours est la colonne transactions.status ; les messages en sont la trace lisible.
 *
 * Messages éphémères et chiffrés : contenu chiffré (AES-256-GCM) ; effacés, avec leurs fichiers, 10 jours après la
 * clôture de leur transaction (une transaction en cours garde ses messages : délai de 7 jours, vérification Mandix).
 *
 * Preuve de paiement : « Valide : C'est bon ✅ », « Rejeté : C'est pas bon ❌ », « En attente : Pas encore bon 🔄 ».
 *  - En attente : 7 jours au plus, rappel quotidien au mandataire ; ensuite le client choisit Je laisse ou
 *    Faire vérifier ce mandataire.
 *  - Rejeté : le mandataire joint obligatoirement une preuve du rejet (capture, document…), visible par le client.
 *    1er rejet : le client choisit Attendre (7 jours, puis Je laisse / Je renvoie ma preuve), Je laisse, ou Je
 *    renvoie ma preuve ; 2e rejet : Attendre (7 jours, puis Je laisse / Faire vérifier), Je laisse, ou Faire
 *    vérifier ce mandataire.
 *  - Attendre : pendant les 7 jours, le mandataire peut encore valider, ou rejeter (avec preuve : nouveau rejet,
 *    nouveau choix du client). Règles des décisions : PROOF_DECISIONS (services/chatFlow.js).
 *  - Vérification : le mandataire est restreint et envoie les preuves du refus sous 72 h ; l'équipe Mandix lève la
 *    restriction (refus justifié) ou la prolonge de 100 jours (refus non justifié, ou aucune preuve).
 *    Restreint : plus d'ajout de compte, niveau bloqué.
 *  - Validée ou rejetée, la transaction se termine par l'évaluation du client ; seules les validées font
 *    monter de niveau.
 *
 * Diffusion : « message:new » aux participants de la conversation, « conversation:update » (aperçu, non lus) et
 * notification au destinataire.
 */
import config from "../config/app.js";
import pool, { withTransaction } from "../config/database.js";
import { Conversation, Transaction, ConversationEvent, Attachment } from "../models/Messaging.js";
import { MandataireAccount, accountTypeIds } from "../models/MandataireAccount.js";
import { AuditLog } from "../models/Security.js";
import { ACCOUNT_TYPES, ACCOUNT_OPTIONS } from "../content/account-types.js";
import { COUNTRIES, countryName } from "../content/countries.js";
import { PAYOUT_FIELD_TYPES, payoutMethod, payoutMethodsFor, payoutMethodName } from "../content/payout-methods.js";
import { appreciationsFor } from "../content/reviews.js";
import { EUR_RATES, limitForTransactions, limitLabel } from "../utils/limits.js";
import { CERTIFICATION_THRESHOLD } from "../utils/badges.js";
import { sensitiveReason } from "../utils/sensitive.js";
import { avatarSvg, defaultAvatarSpec } from "../utils/avatar.js";
import { presence } from "../utils/presence.js";
import { eventText, PENDING_MAX_DAYS, MAX_REJECTIONS, VERIFICATION_HOURS, SANCTION_DAYS, rejectionChoices, expiredChoices, choiceList, PROOF_DECISIONS, statusesAllowing } from "./chatFlow.js";
import * as notifications from "./notificationService.js";
import * as files from "./fileService.js";
import * as hub from "../realtime/hub.js";
import { pushBadges, pushAdminBadges } from "./badgeService.js";

/** Conversation lue : les autres onglets du même compte effacent ses non-lus et reçoivent les compteurs exacts. */
async function syncRead(userId, conversationPublicId) {
  hub.toUser(userId, "conversation:read", { conversationId: conversationPublicId });
  await pushBadges(userId);
}

const DAY_MS = 24 * 3600 * 1000;

export class MessagingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.publicMessage = message;
  }
}
const fail = (message, status) => { throw new MessagingError(message, status); };

const money = (amount, currency) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: ["XOF", "XAF", "GNF", "JPY"].includes(currency) ? 0 : 2 }).format(amount);

/* ------------------------------------------------------------------ Participants */

/**
 * Conversation et rôle de l'utilisateur dans celle-ci ; refuse toute personne qui n'y participe pas.
 * @returns {{conversation: object, role: 'client'|'mandataire', otherUserId: number}}
 */
export async function participation(user, conversation, mandataire = null) {
  if (!conversation) fail("Conversation introuvable.", 404);
  if (user.role === "client" && Number(conversation.client_id) === Number(user.id)) {
    return { conversation, role: "client", otherUserId: Number(conversation.mandataire_user_id) };
  }
  if (user.role === "mandataire" && mandataire && Number(conversation.mandataire_id) === Number(mandataire.id)) {
    return { conversation, role: "mandataire", otherUserId: Number(conversation.client_id) };
  }
  fail("Conversation introuvable.", 404);
}

/** Mandataire public (actif, au moins un compte publié) d'après l'adresse de sa fiche. */
async function publicMandataireBySlug(slug) {
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,140}$/.test(slug)) return null;
  const [rows] = await pool.execute(
    `SELECT pm.id, pm.slug, pm.pseudo, pm.transactions_count, pm.level_transactions, pm.is_verified, pm.last_seen_at, mp.user_id
       FROM v_public_mandataires pm JOIN mandataire_profiles mp ON mp.id = pm.id WHERE pm.slug = ? LIMIT 1`,
    [slug],
  );
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------ Actions du parcours */

const isInt = (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0;

function optionFor(slug, value) {
  const options = ACCOUNT_OPTIONS[slug];
  if (!options) return {};
  const item = options.items.find(([key]) => key === value);
  if (!item) fail(`Choisissez : ${options.label.toLowerCase()}.`, 422);
  return { option: item[0], optionLabel: item[1], optionText: `${options.label} : ${item[1]}` };
}

/* Informations du moyen de réception du client (content/payout-methods.js) : contrôlées ici, quel que soit le
   navigateur. Jamais de numéro de carte ni de phrase de récupération. */
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PAYOUT_FIELD_RULES = {
  phone: [/^\+?[0-9][0-9 ().-]{6,22}$/, "Indiquez le numéro de téléphone (avec l'indicatif du pays si possible)."],
  holder: [/^[\p{L}][\p{L}\p{M}' .-]{1,99}$/u, "Indiquez le nom et les prénoms (lettres uniquement)."],
  iban: [/^[A-Z0-9 ]{10,60}$/, "Indiquez le RIB ou l'IBAN (10 à 60 lettres et chiffres)."],
  address: [/^[A-Za-z0-9:_-]{20,120}$/, "Indiquez l'adresse publique du portefeuille."],
  network: [/^[\p{L}0-9 ()._-]{2,30}$/u, "Indiquez le réseau (ex. TRC20, BEP20, Bitcoin)."],
  email: [EMAIL_PATTERN, "Indiquez l'adresse e-mail du compte."],
  city: [/^[\p{L}][\p{L}\p{M}' .-]{1,59}$/u, "Indiquez la ville de retrait."],
};
function readPayoutFields(method, raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const values = {};
  for (const [key] of PAYOUT_FIELD_TYPES[method.type]) {
    let value = typeof input[key] === "string" ? input[key].trim().replace(/\s+/g, " ") : "";
    if (key === "iban") value = value.toUpperCase();
    if (key === "email") value = value.toLowerCase();
    const [pattern, message] = PAYOUT_FIELD_RULES[key];
    if (!pattern.test(value)) fail(message, 422);
    if (key === "phone") {
      const digits = value.replace(/\D/g, "").length;
      if (digits < 8 || digits > 15) fail(message, 422);
    } else {
      const reason = sensitiveReason(value);
      if (reason) fail(reason, 422);
    }
    values[key] = value;
  }
  return values;
}

/**
 * Restriction d'un mandataire : plus d'ajout de compte, niveau bloqué au palier atteint au début de la
 * restriction. Une sanction (100 jours) n'est jamais raccourcie par une nouvelle vérification.
 * (Affectations dans cet ordre : chaque expression lit encore l'ancienne valeur de restricted_until.)
 */
async function restrictMandataire(connection, mandataireId, { hours = 0, days = 0, reason }) {
  const interval = days ? `INTERVAL ${Number(days)} DAY` : `INTERVAL ${Number(hours)} HOUR`;
  await connection.execute(
    `UPDATE mandataire_profiles
        SET restricted_level_count = IF(restricted_until > UTC_TIMESTAMP(), restricted_level_count, transactions_count),
            restriction_reason = CASE WHEN ? = 'sanction' THEN 'sanction'
                                      WHEN restriction_reason = 'sanction' AND restricted_until > UTC_TIMESTAMP() THEN 'sanction'
                                      ELSE 'verification' END,
            restricted_until = GREATEST(COALESCE(restricted_until, UTC_TIMESTAMP()), UTC_TIMESTAMP() + ${interval})
      WHERE id = ?`,
    [reason, mandataireId],
  );
}

/** Refus justifié : la restriction de vérification est levée (sauf autre vérification en cours ou sanction). */
async function liftVerificationRestriction(connection, mandataireId) {
  await connection.execute(
    `UPDATE mandataire_profiles SET restricted_until = NULL, restriction_reason = NULL, restricted_level_count = NULL
      WHERE id = ? AND restriction_reason = 'verification'
        AND NOT EXISTS (SELECT 1 FROM verification_requests v WHERE v.mandataire_id = ? AND v.status = 'open')`,
    [mandataireId, mandataireId],
  );
}

const fileView = (row) => ({
  attachmentId: Number(row.id),
  name: row.original_name,
  type: row.mime_type,
  size: row.size_bytes,
  url: `/fichiers/${row.id}`,
  preview: row.mime_type.startsWith("image/") ? `/fichiers/${row.id}` : null,
});

async function lastProofEvent(transactionId, connection) {
  const [rows] = await connection.execute(
    "SELECT id FROM conversation_events WHERE transaction_id = ? AND event_type = 'proof' ORDER BY id DESC LIMIT 1",
    [transactionId],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/** Destinataire et contenu de la notification de chaque étape (null : pas de notification). */
function notificationFor(type, data, { role, conversation }) {
  const toClient = role === "mandataire";
  const name = toClient ? conversation.mandataire_pseudo : conversation.client_pseudo;
  const link = toClient ? `/client/messages/${conversation.mandataire_slug}` : `/mandataire/messages/${conversation.public_id}`;
  const titles = {
    request: `Nouvelle demande de ${name}`,
    ask_amount: `${name} vous demande le montant`,
    amount: `${name} a indiqué le montant : ${data.label}`,
    receive_info: `${name} vous a envoyé ses coordonnées`,
    proof: `Preuve de paiement reçue de ${name}`,
    proof_status: { validated: "Paiement validé", rejected: "Preuve de paiement rejetée", pending: "Paiement en attente" }[data.status],
    client_choice: { wait: `${name} attend 7 jours que le paiement arrive`, leave: `${name} a laissé la transaction`, resend: `${name} va renvoyer sa preuve de paiement`, verify: `${name} demande la vérification de votre compte` }[data.choice],
    refusal_proof: `${name} a envoyé les preuves du refus à l'équipe Mandix`,
    ask_payout: `${name} vous demande le moyen de réception`,
    credit_proof_request: `${name} demande une preuve de non-crédit`,
    credit_proof: `${name} a envoyé ses preuves`,
    credit_proof_ok: `${name} a vérifié vos preuves`,
    verification_request: `${name} a demandé une vérification à Mandix`,
    payout_info: `${name} a indiqué son compte de réception`,
    sent: `${name} a envoyé l'argent`,
    receipt: data.received ? `${name} a bien reçu l'argent` : `${name} n'a pas encore reçu l'argent`,
  };
  if (!titles[type]) return null;
  const body = type === "client_choice" && data.choice === "verify"
    ? `Votre compte est restreint pendant la vérification. Envoyez les preuves du refus dans les ${VERIFICATION_HOURS} heures : sans preuve valable, la restriction dure ${SANCTION_DAYS} jours.`
    : type === "proof_status" && data.status === "rejected"
      ? `${name} a joint la preuve du rejet. Choisissez : ${choiceList(rejectionChoices(Number(data.rejections) || 1))}.`
      : eventText({ type, data });
  return { title: titles[type], body, link, cta: "Ouvrir la conversation", type: `message.${type}` };
}

/**
 * Applique une action d'un participant (message préfait) dans une transaction de base de données.
 * @returns {Promise<{event: object, conversation: object, status: string|null}>}
 */
export async function act(user, { conversationId = null, mandataireSlug = null, type, data = {} }, { mandataire = null, ip = null, userAgent = null } = {}) {
  if (typeof type !== "string") fail("Action inconnue.");
  data = data && typeof data === "object" && !Array.isArray(data) ? data : {};

  // Conversation : existante, ou créée par la première demande d'un client.
  let conversation = conversationId ? await Conversation.findByPublicId(conversationId) : null;
  if (!conversation && user.role === "client" && type === "request" && mandataireSlug) {
    const target = await publicMandataireBySlug(mandataireSlug);
    if (!target) fail("Ce mandataire n'est pas disponible.", 404);
    conversation = await Conversation.findOrCreate(user.id, target.id);
  }
  const { role, otherUserId } = await participation(user, conversation, mandataire);

  const result = await withTransaction(async (connection) => {
    const tx = await Transaction.findOpen(conversation.id, connection, { lock: true });
    const expect = (who, ...statuses) => {
      if (role !== who) fail("Ce n'est pas à vous d'envoyer ce message.", 403);
      if (!tx || !statuses.includes(tx.status)) fail("Cette étape n'est plus d'actualité : rechargez la conversation.", 409);
    };
    let transactionId = tx ? Number(tx.id) : null;
    let payload = {};
    let update = {};
    let attachments = [];

    switch (type) {
      case "request": {
        if (role !== "client") fail("Seul le client peut ouvrir une transaction.", 403);
        if (tx) fail("Une transaction est déjà en cours dans cette conversation.", 409);
        if (!isInt(data.accountId)) fail("Choisissez l'un des comptes du mandataire.", 422);
        const account = await MandataireAccount.findPublished(conversation.mandataire_id, Number(data.accountId));
        if (!account) fail("Ce compte n'est plus proposé par le mandataire.", 409);
        transactionId = await Transaction.create({ conversationId: conversation.id, clientId: user.id, mandataireId: conversation.mandataire_id, accountId: account.id }, connection);
        payload = { accountId: account.id, accountName: account.typeName, accountType: account.type, currency: account.currency, country: account.country };
        break;
      }
      case "ask_amount":
        expect("mandataire", "requested");
        update = { status: "awaiting_amount", first_response_at: "NOW" };
        break;
      case "amount": {
        expect("client", "awaiting_amount");
        const amount = Math.round(Number(String(data.amount).replace(",", ".")) * 100) / 100;
        if (!Number.isFinite(amount) || amount <= 0 || amount > 1e11) fail("Indiquez un montant valide, en chiffres.", 422);
        const currency = typeof data.currency === "string" ? data.currency.toUpperCase() : "";
        if (!EUR_RATES[currency]) fail("Devise non prise en charge.", 422);
        const eur = Math.round((amount / EUR_RATES[currency]) * 100) / 100;
        const limitEur = limitForTransactions(Number(conversation.level_transactions) || 0); // niveau bloqué si restreint
        if (limitEur != null && eur > limitEur) {
          fail(`Montant au-delà du plafond du mandataire : environ ${money(eur, "EUR")} pour un plafond de ${money(limitEur, "EUR")} par transaction.`, 422);
        }
        update = { status: "awaiting_receive_details", currency, amount, amount_eur: eur, eur_rate: EUR_RATES[currency], limit_eur: limitEur };
        payload = { amount, currency, eur, label: money(amount, currency) };
        break;
      }
      case "receive_info": {
        expect("mandataire", "awaiting_receive_details");
        const account = await MandataireAccount.findPublished(conversation.mandataire_id, Number(tx.mandataire_account_id), { withReceive: true });
        if (!account) fail("Ce compte a été retiré : ajoutez-le de nouveau dans « Mes comptes ».", 409);
        const option = optionFor(account.type, data.option);
        // Coordonnées enregistrées avec le compte (E-mail, RIB) : elles seules font foi, jamais celles envoyées par
        // le navigateur. Compte ajouté sans coordonnées : le mandataire les saisit pour cette transaction (contrôlées).
        let receive = account.receive;
        if (!receive) {
          receive = typeof data.receive === "string" ? data.receive.trim().replace(/\s+/g, " ") : "";
          if (receive.length < 3 || receive.length > 200) fail("Indiquez vos coordonnées de réception (e-mail, RIB…).", 422);
          const reason = sensitiveReason(receive);
          if (reason) fail(reason, 422);
        }
        update = { status: "awaiting_proof", receive_option: option.option ?? null };
        payload = { accountName: account.typeName, accountType: account.type, receive, ...option };
        break;
      }
      case "proof": {
        expect("client", "awaiting_proof");
        if (!isInt(data.attachmentId)) fail("Joignez votre preuve de paiement.", 422);
        attachments = await Attachment.findUnlinked([Number(data.attachmentId)], { transactionId, userId: user.id, kind: "payment_proof" }, connection);
        if (!attachments.length) fail("Preuve introuvable : envoyez de nouveau le fichier.", 422);
        update = { status: "proof_review" };
        payload = fileView(attachments[0]);
        break;
      }
      case "proof_status": {
        // « Valide : C'est bon ✅ », « Rejeté : C'est pas bon ❌ », « En attente : Pas encore bon 🔄 », selon l'étape
        // (PROOF_DECISIONS) : pendant une attente (la sienne ou celle du client), le mandataire peut encore trancher.
        const status = data.status;
        const allowed = statusesAllowing(status);
        if (!allowed.length) fail("Décision inconnue.", 422);
        expect("mandataire", ...allowed);
        const proofEventId = await lastProofEvent(transactionId, connection);
        const [proofFile] = proofEventId ? (await connection.execute("SELECT id FROM attachments WHERE event_id = ? LIMIT 1", [proofEventId]))[0] : [];
        const rejections = Number(tx.proof_rejections || 0) + (status === "rejected" ? 1 : 0);
        if (status === "rejected") {
          // Rejet : preuve obligatoire pour le client (1 à 5 captures ou documents), envoyée avant ce message.
          const ids = Array.isArray(data.attachmentIds) ? [...new Set(data.attachmentIds.filter(isInt).map(Number))].slice(0, 5) : [];
          if (!ids.length) fail("Joignez la preuve du rejet (capture, document…).", 422);
          attachments = await Attachment.findUnlinked(ids, { transactionId, userId: user.id, kind: "rejection_proof" }, connection);
          if (attachments.length !== ids.length) fail("Une des preuves du rejet est introuvable : envoyez-la de nouveau.", 422);
        }
        if (proofFile) await Attachment.decide(proofFile.id, status, connection);
        update = status === "validated" ? { status: "proof_validated", proof_validated_at: "NOW" }
          : status === "rejected"
            // Le client choisit : Attendre, Je laisse, Je renvoie ma preuve (1er rejet) ou Faire vérifier (2e).
            ? { status: "rejection_choice", proof_rejections: "INCREMENT" }
            : { status: "proof_pending", proof_pending_since: "NOW", pending_reminded_at: null, client_choice_notified_at: null };
        payload = { status, proofId: proofEventId ? String(proofEventId) : null, rejections };
        if (attachments.length) payload.files = attachments.map(fileView);
        break;
      }
      case "client_choice": {
        // Après un rejet : Attendre / Je laisse / Je renvoie ma preuve (1er) ou Faire vérifier ce mandataire (2e).
        // À la fin des 7 jours (En attente du mandataire, ou Attendre) : Je laisse / Faire vérifier ce mandataire.
        const choice = data.choice;
        if (!["wait", "leave", "resend", "verify"].includes(choice)) fail("Choix inconnu.", 422);
        expect("client", "rejection_choice", "proof_pending", "client_waiting");
        const rejections = Number(tx.proof_rejections) || 0;
        const allowed = tx.status === "rejection_choice" ? rejectionChoices(rejections) : expiredChoices(tx.status, rejections);
        if (!allowed.includes(choice)) fail(`Choisissez : ${choiceList(allowed)}.`, 422);
        if (tx.status !== "rejection_choice") {
          const since = tx.proof_pending_since ? new Date(tx.proof_pending_since).getTime() : Date.now();
          if (Date.now() < since + PENDING_MAX_DAYS * DAY_MS) fail("Le délai de 7 jours n'est pas encore écoulé.", 409);
        }
        update = choice === "wait" ? { status: "client_waiting", proof_pending_since: "NOW", pending_reminded_at: null, client_choice_notified_at: null }
          : choice === "leave" ? { status: "awaiting_review", outcome: "rejected" }
            : choice === "resend" ? { status: "awaiting_proof" }
              : { status: "verification_requested" };
        payload = { choice };
        break;
      }
      case "refusal_proof": {
        // Vérification demandée par le client : le mandataire envoie les preuves du refus (1 à 5 fichiers).
        expect("mandataire", "verification_requested");
        const ids = Array.isArray(data.attachmentIds) ? [...new Set(data.attachmentIds.filter(isInt).map(Number))].slice(0, 5) : [];
        if (!ids.length) fail("Joignez au moins une preuve du refus.", 422);
        attachments = await Attachment.findUnlinked(ids, { transactionId, userId: user.id, kind: "credit_evidence" }, connection);
        if (attachments.length !== ids.length) fail("Une des preuves est introuvable : envoyez-les de nouveau.", 422);
        update = { status: "verification_review" };
        payload = { files: attachments.map(fileView) };
        break;
      }
      case "ask_payout":
        // Après « Valide : C'est bon ✅ » : « Par quel moyen souhaitez-vous recevoir l'argent ? »
        expect("mandataire", "proof_validated");
        update = { status: "awaiting_payout_details" };
        break;
      case "payout_info": {
        // Pays du client → moyens de réception de ce pays → informations du moyen (Mobile Money : numéro + nom…).
        expect("client", "awaiting_payout_details");
        const country = typeof data.country === "string" ? data.country.toUpperCase() : "";
        if (!COUNTRIES.some((c) => c.code === country)) fail("Choisissez votre pays.", 422);
        const method = payoutMethod(country, data.method);
        if (!method) fail("Choisissez un moyen de réception disponible dans ce pays.", 422);
        const fields = readPayoutFields(method, data.fields);
        const receive = PAYOUT_FIELD_TYPES[method.type].map(([key, label]) => `${label} : ${fields[key]}`).join("\n");
        update = {
          status: "awaiting_transfer", payout_method: method.slug, payout_country: country,
          payout_account_type_id: null, payout_option: null,
          payout_details_enc: Transaction.encryptPayout(transactionId, receive),
        };
        payload = {
          method: method.slug, methodName: method.name, methodType: method.type,
          country, countryName: countryName(country), accountName: method.name, receive,
        };
        break;
      }
      case "sent": {
        expect("mandataire", "awaiting_transfer");
        if (!isInt(data.attachmentId)) fail("Joignez la capture du transfert.", 422);
        attachments = await Attachment.findUnlinked([Number(data.attachmentId)], { transactionId, userId: user.id, kind: "transfer_proof" }, connection);
        if (!attachments.length) fail("Capture introuvable : envoyez de nouveau le fichier.", 422);
        update = { status: "awaiting_receipt", transfer_sent_at: "NOW" };
        payload = { accountName: tx.payout_name || payoutMethodName(tx.payout_method), again: Boolean(tx.transfer_sent_at), ...fileView(attachments[0]) };
        break;
      }
      case "receipt": {
        const received = data.received === true;
        if (received) expect("client", "awaiting_receipt", "awaiting_transfer");
        else expect("client", "awaiting_receipt");
        if (received && tx.status === "awaiting_transfer" && !tx.transfer_sent_at) fail("Le mandataire n'a pas encore envoyé l'argent.", 409);
        update = received ? { status: "awaiting_review", outcome: "success", receipt_confirmed_at: "NOW" } : { status: "awaiting_transfer" };
        payload = { received };
        break;
      }
      default:
        fail("Action inconnue.", 400);
    }

    const event = await ConversationEvent.create(
      { conversationId: conversation.id, transactionId, role, userId: user.id, type, data: payload },
      connection,
    );
    if (attachments.length) await Attachment.link(attachments.map((a) => Number(a.id)), Number(event.id), connection);
    if (Object.keys(update).length) await Transaction.update(transactionId, update, connection);
    const verify = type === "client_choice" && payload.choice === "verify";
    if (verify) {
      // « Faire vérifier ce mandataire » : demande pour l'équipe Mandix, preuves du refus attendues sous 72 h,
      // et restriction du mandataire pendant la vérification (plus d'ajout de compte, niveau bloqué).
      const reference = `VR-${new Date().getUTCFullYear()}-${String(event.id).padStart(6, "0")}`;
      await connection.execute(
        `INSERT INTO verification_requests (reference, transaction_id, conversation_id, client_id, mandataire_id, request_event_id, evidence_due_at)
         VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP() + INTERVAL ${VERIFICATION_HOURS} HOUR)`,
        [reference, transactionId, conversation.id, conversation.client_id, conversation.mandataire_id, event.id],
      );
      await restrictMandataire(connection, conversation.mandataire_id, { hours: VERIFICATION_HOURS, reason: "verification" });
    }
    await Conversation.touch(conversation.id, connection);
    return { event, status: update.status ?? (type === "request" ? "requested" : tx?.status ?? null), verify };
  });

  if (type === "request" || result.verify) {
    await AuditLog.record({
      actorUserId: user.id, actorRole: role, action: result.verify ? "conversation.verification_request" : "conversation.request",
      entityType: "conversation", entityId: conversation.id, ip, userAgent,
    });
  }
  await broadcast(conversation, role, otherUserId, result.event, result.status);
  return { ...result, conversation };
}

/** Diffusion en temps réel et notification du destinataire. */
async function broadcast(conversation, role, otherUserId, event, status) {
  hub.toConversation(conversation.public_id, "message:new", { conversationId: conversation.public_id, event, status });
  const preview = eventText(event);
  const listUpdate = (forRole) => ({
    conversationId: conversation.public_id,
    key: conversation.public_id,
    slug: forRole === "client" ? conversation.mandataire_slug : conversation.public_id,
    preview: (event.from === forRole ? "Vous : " : "") + preview,
    at: event.at,
  });
  hub.toUser(Number(conversation.client_id), "conversation:update", listUpdate("client"));
  hub.toUser(Number(conversation.mandataire_user_id), "conversation:update", listUpdate("mandataire"));
  const note = notificationFor(event.type, event.data, { role, conversation });
  if (note && otherUserId) {
    await notifications.notify(otherUserId, { ...note, actorUserId: event.from === "system" ? null : (role === "client" ? Number(conversation.client_id) : Number(conversation.mandataire_user_id)) });
  }
  // Compteurs exacts (messages et notifications non lus) pour tous les onglets des deux participants.
  await pushBadges(Number(conversation.client_id), Number(conversation.mandataire_user_id));
  // File « Vérifications » de l'équipe : nouvelle demande, ou preuves du refus reçues.
  if ((event.type === "client_choice" && event.data?.choice === "verify") || event.type === "refusal_proof") await pushAdminBadges();
}

/* ------------------------------------------------------------------ Évaluation (hors messages) */

/**
 * Évaluation obligatoire du client, que la transaction soit validée ou rejetée : elle la clôt et met à jour la note
 * du mandataire. Seules les transactions validées comptent pour le niveau (plafond, certification) ; les rejetées
 * figurent dans les statistiques du profil. Pas de certification pendant une restriction (niveau bloqué).
 * L'évaluation n'est pas un message et n'est pas envoyée au mandataire.
 */
export async function review(user, { conversationId, rating, appreciation }, { ip = null, userAgent = null } = {}) {
  const conversation = await Conversation.findByPublicId(conversationId);
  const { role } = await participation(user, conversation);
  if (role !== "client") fail("Seul le client évalue la transaction.", 403);
  const note = Number(rating);
  if (!Number.isInteger(note) || note < 1 || note > 5) fail("Choisissez une note de 1 à 5.", 422);
  if (!appreciationsFor(note).some(([key]) => key === appreciation)) fail("Choisissez une appréciation.", 422);

  const { transactionId, success } = await withTransaction(async (connection) => {
    const tx = await Transaction.findOpen(conversation.id, connection, { lock: true });
    if (!tx || tx.status !== "awaiting_review") fail("Cette transaction ne peut pas être évaluée.", 409);
    const ok = tx.outcome !== "rejected";
    await connection.execute(
      "INSERT INTO reviews (transaction_id, client_id, mandataire_id, rating, appreciation) VALUES (?, ?, ?, ?, ?)",
      [tx.id, user.id, conversation.mandataire_id, note, appreciation],
    );
    await Transaction.update(tx.id, { status: ok ? "completed" : "rejected", completed_at: "NOW" }, connection);
    await connection.execute(
      `UPDATE mandataire_profiles
          SET rating_avg = ROUND(((COALESCE(rating_avg, 0) * rating_count) + ?) / (rating_count + 1), 2),
              rating_count = rating_count + 1,
              transactions_count = transactions_count + ?,
              rejected_count = rejected_count + ?,
              certified_at = IF(certified_at IS NULL AND transactions_count >= ?
                                AND (restricted_until IS NULL OR restricted_until <= UTC_TIMESTAMP()), UTC_TIMESTAMP(), certified_at)
        WHERE id = ?`,
      [note, ok ? 1 : 0, ok ? 0 : 1, CERTIFICATION_THRESHOLD, conversation.mandataire_id],
    );
    return { transactionId: Number(tx.id), success: ok };
  });
  await AuditLog.record({ actorUserId: user.id, actorRole: "client", action: "transaction.review", entityType: "transaction", entityId: transactionId, metadata: { rating: note, outcome: success ? "success" : "rejected" }, ip, userAgent });
  hub.toConversation(conversation.public_id, "transaction:closed", { conversationId: conversation.public_id, status: success ? "completed" : "rejected" });
  return { transactionId };
}

/* ------------------------------------------------------------------ Pièces jointes */

const UPLOAD_RULES = {
  payment_proof: { role: "client", statuses: ["awaiting_proof"] },
  transfer_proof: { role: "mandataire", statuses: ["awaiting_transfer"] },
  credit_evidence: { role: "mandataire", statuses: ["verification_requested"] }, // preuves du refus (vérification)
  rejection_proof: { role: "mandataire", statuses: statusesAllowing("rejected") }, // jointe à « Rejeté »
};

/** Fichier envoyé avant le message qui le joint : vérifié, chiffré, rattaché à la transaction en cours. */
export async function upload(user, { conversationId, kind, buffer, originalName }, { mandataire = null } = {}) {
  const conversation = await Conversation.findByPublicId(conversationId);
  const { role } = await participation(user, conversation, mandataire);
  const rule = UPLOAD_RULES[kind];
  if (!rule) fail("Type de fichier inconnu.", 422);
  if (rule.role !== role) fail("Ce n'est pas à vous d'envoyer ce fichier.", 403);
  const tx = await Transaction.findOpen(conversation.id);
  if (!tx || !rule.statuses.includes(tx.status)) fail("Cette étape n'attend pas de fichier.", 409);
  const stored = await files.storeUpload(buffer, originalName);
  if (!stored.ok) fail(stored.error, 422);
  const id = await Attachment.create({
    conversationId: conversation.id, transactionId: tx.id, userId: user.id, kind,
    storageKey: stored.storageKey, name: stored.name, mime: stored.mime, size: stored.size, sha256: stored.sha256,
  });
  return { attachmentId: id, name: stored.name, type: stored.mime, size: stored.size };
}

/** Lecture d'un fichier : participants de la conversation, ou administrateur (vérifications). */
export async function readAttachment(user, attachmentId, { mandataire = null } = {}) {
  if (!isInt(attachmentId)) fail("Fichier introuvable.", 404);
  const row = await Attachment.findById(Number(attachmentId));
  if (!row) fail("Fichier introuvable.", 404);
  if (user.role !== "admin") {
    const [convRows] = await pool.execute("SELECT public_id FROM conversations WHERE id = ?", [row.conversation_id]);
    const conversation = await Conversation.findByPublicId(convRows[0]?.public_id);
    await participation(user, conversation, mandataire);
  }
  return { buffer: await files.readFile(row.storage_key), mime: row.mime_type, name: row.original_name };
}

/* ------------------------------------------------------------------ Lecture des conversations (pages) */

const shortWhen = (date) => {
  const d = new Date(date);
  const day = (x) => new Intl.DateTimeFormat("fr-CA", { timeZone: config.timezone }).format(x);
  if (day(d) === day(new Date())) return new Intl.DateTimeFormat("fr-FR", { timeZone: config.timezone, hour: "2-digit", minute: "2-digit" }).format(d);
  if (day(d) === day(new Date(Date.now() - DAY_MS))) return "Hier";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: config.timezone, day: "numeric", month: "short" }).format(d);
};

/** Moyens de réception proposés au client, par pays (étape « Par quel moyen souhaitez-vous recevoir l'argent ? »). */
const PAYOUT_CHOICES = {
  countries: COUNTRIES.map((c) => ({ code: c.code, name: c.name })),
  methods: Object.fromEntries(COUNTRIES.map((c) => [c.code, payoutMethodsFor(c.code)])),
  fields: PAYOUT_FIELD_TYPES,
};

function accountForFlow(account, withReceive) {
  const type = ACCOUNT_TYPES.find((t) => t.slug === account.type) || {};
  return {
    id: account.id, type: account.type, name: account.typeName || type.name || account.type, logo: type.logo ?? null,
    options: ACCOUNT_OPTIONS[account.type] ?? null, currency: account.currency, country: account.country, countryName: countryName(account.country),
    ...(withReceive ? { receive: account.receive } : {}),
  };
}

/** Demandes déjà évaluées (transactions terminées) dont le message de demande est encore visible. */
async function reviewedRequestIds(conversationId) {
  const [rows] = await pool.execute(
    `SELECT e.id FROM conversation_events e JOIN transactions t ON t.id = e.transaction_id
      WHERE e.conversation_id = ? AND e.event_type = 'request' AND t.status = 'completed'`,
    [conversationId],
  );
  return rows.map((r) => String(r.id));
}

/**
 * Données des pages Messages : liste des conversations et conversation active, au format des vues
 * (partials/dash/chat*.ejs) et de public/js/chat.js.
 * active : client → adresse de la fiche du mandataire ; mandataire → identifiant public de la conversation.
 */
export async function chatView(user, { active = null, mandataire = null, basePath }) {
  const role = user.role;
  const rows = role === "client" ? await Conversation.listFor({ clientId: user.id }) : await Conversation.listFor({ mandataireId: mandataire.id });
  const unread = await Conversation.unreadCounts(rows.map((r) => Number(r.id)), role);
  const list = [];
  for (const c of rows) {
    const last = await ConversationEvent.last(c.id);
    const id = role === "client" ? c.mandataire_slug : c.public_id;
    const name = role === "client" ? c.mandataire_pseudo : c.client_pseudo;
    list.push({
      id, name, key: c.public_id, href: `${basePath}/${id}`,
      avatar: avatarSvg(defaultAvatarSpec(role === "client" ? c.mandataire_slug : c.client_public_id), { size: 44 }),
      preview: last ? (last.from === role ? "Vous : " : "") + eventText(last) : "Nouvelle conversation",
      when: last ? shortWhen(last.at) : "",
      unread: unread.get(Number(c.id)) || 0,
      isActive: active != null && id === active,
    });
  }

  let thread = null;
  if (active) {
    let conversation = role === "client" ? rows.find((c) => c.mandataire_slug === active) : rows.find((c) => c.public_id === active);
    let target = null;
    if (role === "client") {
      target = await publicMandataireBySlug(active);
      if (!target && !conversation) return null; // mandataire inconnu ou indisponible
    } else if (!conversation) {
      return null;
    }
    const mandataireId = conversation ? Number(conversation.mandataire_id) : Number(target.id);
    const transactions = conversation ? Number(conversation.level_transactions) : Number(target.level_transactions); // niveau bloqué si restreint
    const accounts = role === "client"
      ? (await MandataireAccount.listPublic(mandataireId)).map((a) => accountForFlow(a, false))
      : (await MandataireAccount.listForOwner(mandataireId)).map((a) => accountForFlow(a, true));
    const events = conversation ? await ConversationEvent.list(conversation.id) : [];
    const limitEur = limitForTransactions(transactions);
    const otherName = role === "client" ? (conversation?.mandataire_pseudo ?? target.pseudo) : conversation.client_pseudo;
    if (conversation) {
      await Conversation.markRead(conversation.id, role);
      await syncRead(user.id, conversation.public_id);
    }
    thread = {
      id: active,
      name: otherName,
      unread: 0,
      avatarSvg: avatarSvg(defaultAvatarSpec(role === "client" ? active : conversation.client_public_id), { size: 44 }),
      verified: role === "client" ? Boolean(conversation ? conversation.verified_at : Number(target.is_verified) === 1) : false,
      presence: presence(role === "client" ? (conversation?.mandataire_last_seen ?? target.last_seen_at) : conversation.client_last_seen),
      profileHref: role === "client" ? `/client/mandataires/${active}` : null,
      flow: {
        transport: "socket",
        key: conversation ? conversation.public_id : `nouvelle:${active}`,
        conversationId: conversation ? conversation.public_id : null,
        mandataireSlug: role === "client" ? active : null,
        role,
        otherName,
        accounts,
        limitEur,
        limitLabel: limitLabel(limitEur),
        rates: EUR_RATES,
        pendingMaxDays: PENDING_MAX_DAYS,
        payout: PAYOUT_CHOICES,
        maxRejections: MAX_REJECTIONS,
        proofDecisions: PROOF_DECISIONS, // règles des décisions du mandataire, appliquées aussi par le serveur
        verificationHours: VERIFICATION_HOURS,
        sanctionDays: SANCTION_DAYS,
        events,
        reviewed: conversation && role === "client" ? await reviewedRequestIds(conversation.id) : [],
        retentionDays: config.messages.retentionDays,
      },
    };
    const item = list.find((i) => i.id === active);
    if (item) item.unread = 0;
  }
  return { list, thread };
}

export async function markRead(user, conversationId, { mandataire = null } = {}) {
  const conversation = await Conversation.findByPublicId(conversationId);
  const { role } = await participation(user, conversation, mandataire);
  await Conversation.markRead(conversation.id, role);
  await syncRead(user.id, conversation.public_id);
}

/* ------------------------------------------------------------------ Ménage : messages éphémères */

/**
 * Efface les messages (et leurs fichiers) des transactions clôturées (validées, rejetées ou annulées) depuis plus de 10 jours.
 * Les transactions elles-mêmes sont conservées (plafond, statistiques, évaluations), sans coordonnées.
 */
export async function purgeExpiredMessages() {
  const days = config.messages.retentionDays;
  const closed = `SELECT id FROM transactions WHERE status IN ('completed','rejected','cancelled')
                   AND COALESCE(completed_at, cancelled_at, updated_at) < UTC_TIMESTAMP() - INTERVAL ${Number(days)} DAY`;
  const [old] = await pool.query(`SELECT id, storage_key FROM attachments WHERE transaction_id IN (${closed})`);
  for (const file of old) await files.deleteFile(file.storage_key);
  if (old.length) await pool.query("DELETE FROM attachments WHERE id IN (?)", [old.map((f) => f.id)]);
  const [events] = await pool.query(`DELETE FROM conversation_events WHERE transaction_id IN (${closed})`);
  // Coordonnées de réception du client : inutiles une fois la transaction close.
  await pool.query(`UPDATE transactions SET payout_details_enc = NULL WHERE payout_details_enc IS NOT NULL AND id IN (SELECT id FROM (${closed}) AS t)`);
  return { messages: events.affectedRows, files: old.length };
}

/* ------------------------------------------------------------------ Vérification par l'équipe Mandix */

/**
 * Clôt une vérification de mandataire, dans une transaction de base de données déjà ouverte :
 *  - justified : le refus était fondé → la restriction de vérification est levée ;
 *  - unjustified / no_evidence : refus non justifié, ou aucune preuve sous 72 h → restriction de 100 jours.
 * La transaction passe à l'évaluation (issue : rejetée) et un message « Équipe Mandix » est publié.
 */
async function closeVerification(connection, request, outcome, { adminId = null } = {}) {
  const justified = outcome === "justified";
  await connection.execute(
    "UPDATE verification_requests SET status = ?, decided_by = ?, decided_at = UTC_TIMESTAMP(), decision_note = ? WHERE id = ?",
    [justified ? "authentic" : "not_authentic", adminId, outcome === "no_evidence" ? `Aucune preuve du refus dans les ${VERIFICATION_HOURS} heures` : null, request.id],
  );
  if (justified) await liftVerificationRestriction(connection, request.mandataire_id);
  else await restrictMandataire(connection, request.mandataire_id, { days: SANCTION_DAYS, reason: "sanction" });

  const tx = await Transaction.findById(request.transaction_id, connection);
  if (!tx || !["verification_requested", "verification_review"].includes(tx.status)) return { event: null, status: tx?.status ?? null };
  await Transaction.update(tx.id, { status: "awaiting_review", outcome: "rejected" }, connection);
  const event = await ConversationEvent.create(
    { conversationId: request.conversation_id, transactionId: tx.id, role: "system", userId: null, type: "verification_result", data: { outcome } },
    connection,
  );
  await Conversation.touch(request.conversation_id, connection);
  return { event, status: "awaiting_review" };
}

/** Diffusion du résultat d'une vérification : conversation, notifications des deux parties, compteurs. */
async function announceVerification(conversationRowId, outcome, event, status) {
  await pushAdminBadges();
  if (!event) return;
  const [rows] = await pool.execute("SELECT public_id FROM conversations WHERE id = ?", [conversationRowId]);
  const conversation = await Conversation.findByPublicId(rows[0]?.public_id);
  if (!conversation) return;
  hub.toConversation(conversation.public_id, "message:new", { conversationId: conversation.public_id, event, status });
  const title = outcome === "justified" ? "Vérification Mandix : refus justifié"
    : outcome === "no_evidence" ? "Vérification Mandix : aucune preuve reçue" : "Vérification Mandix : refus non justifié";
  const body = eventText(event);
  await notifications.notify(Number(conversation.client_id), { type: "message.verification_result", title, body, link: `/client/messages/${conversation.mandataire_slug}`, cta: "Évaluer la transaction" });
  await notifications.notify(Number(conversation.mandataire_user_id), { type: "message.verification_result", title, body, link: `/mandataire/messages/${conversation.public_id}`, cta: "Ouvrir la conversation" });
  await pushBadges(Number(conversation.client_id), Number(conversation.mandataire_user_id));
}

/**
 * Décision de l'équipe sur la vérification d'un mandataire, après examen des preuves du refus :
 * « justified » (refus justifié : restriction levée) ou « unjustified » (restriction de 100 jours).
 * Anciennes valeurs acceptées : authentic → justified, not_authentic → unjustified.
 */
export async function decideVerification(admin, reference, decision, { ip = null, userAgent = null } = {}) {
  const outcome = { justified: "justified", authentic: "justified", unjustified: "unjustified", not_authentic: "unjustified" }[decision];
  if (!outcome) fail("Décision inconnue.", 422);
  const result = await withTransaction(async (connection) => {
    const [[request]] = await connection.execute("SELECT * FROM verification_requests WHERE reference = ? LIMIT 1 FOR UPDATE", [String(reference)]);
    if (!request) fail("Demande introuvable.", 404);
    if (request.status !== "open") fail("Cette demande a déjà été traitée.", 409);
    return { request, ...(await closeVerification(connection, request, outcome, { adminId: admin.id })) };
  });
  await AuditLog.record({ actorUserId: admin.id, actorRole: "admin", action: `verification.${outcome}`, entityType: "verification_request", entityId: result.request.id, ip, userAgent });
  await announceVerification(result.request.conversation_id, outcome, result.event, result.status);
  return { closedOnly: !result.event };
}

/* ------------------------------------------------------------------ Échéances (tâche horaire) */

/**
 * Échéances du parcours, vérifiées toutes les heures (server.js) :
 *  - paiement « En attente » : rappel quotidien au mandataire (valider ou rejeter) ; à 7 jours, le client est
 *    prévenu qu'il peut laisser ou faire vérifier le mandataire ;
 *  - « Attendre » choisi par le client : à 7 jours, le client est prévenu de même ;
 *  - vérification sans preuve du refus après 72 h : refus non justifié, restriction de 100 jours.
 */
export async function runFlowDeadlines() {
  let reminders = 0;
  let clientNotices = 0;
  let expired = 0;

  // 1. Rappel quotidien au mandataire pour chaque paiement en attente.
  const [pending] = await pool.query(
    `SELECT t.id, t.conversation_id, t.proof_pending_since, TIMESTAMPDIFF(DAY, t.proof_pending_since, UTC_TIMESTAMP()) AS days
       FROM transactions t
      WHERE t.status = 'proof_pending' AND t.proof_pending_since IS NOT NULL
        AND COALESCE(t.pending_reminded_at, t.proof_pending_since) <= UTC_TIMESTAMP() - INTERVAL 1 DAY`,
  );
  for (const t of pending) {
    const conversation = await conversationByRowId(t.conversation_id);
    if (!conversation) continue;
    const days = Number(t.days);
    const left = PENDING_MAX_DAYS - days;
    await notifications.notify(Number(conversation.mandataire_user_id), {
      type: "message.pending_reminder",
      title: `Paiement en attente depuis ${days} jour${days > 1 ? "s" : ""}`,
      body: left > 0
        ? `${conversation.client_pseudo} attend votre décision : Valide : C'est bon ✅ ou Rejeté : C'est pas bon ❌ (encore ${left} jour${left > 1 ? "s" : ""}).`
        : `Le délai de ${PENDING_MAX_DAYS} jours est dépassé : répondez à ${conversation.client_pseudo} (Valide ou Rejeté).`,
      link: `/mandataire/messages/${conversation.public_id}`,
      cta: "Répondre",
    });
    await Transaction.update(t.id, { pending_reminded_at: "NOW" }, pool);
    await pushBadges(Number(conversation.mandataire_user_id));
    reminders += 1;
  }

  // 2. Fin des 7 jours (En attente, ou Attendre) : le client laisse, renvoie sa preuve ou fait vérifier le mandataire.
  const [due] = await pool.query(
    `SELECT id, conversation_id, status, proof_rejections FROM transactions
      WHERE status IN ('proof_pending','client_waiting') AND client_choice_notified_at IS NULL
        AND proof_pending_since <= UTC_TIMESTAMP() - INTERVAL ${PENDING_MAX_DAYS} DAY`,
  );
  for (const t of due) {
    const conversation = await conversationByRowId(t.conversation_id);
    if (!conversation) continue;
    await notifications.notify(Number(conversation.client_id), {
      type: "message.pending_expired",
      title: `Délai de ${PENDING_MAX_DAYS} jours écoulé`,
      body: `Le paiement n'est toujours pas validé par ${conversation.mandataire_pseudo}. Choisissez : ${choiceList(expiredChoices(t.status, Number(t.proof_rejections) || 0))}.`,
      link: `/client/messages/${conversation.mandataire_slug}`,
      cta: "Choisir",
    });
    await Transaction.update(t.id, { client_choice_notified_at: "NOW" }, pool);
    await pushBadges(Number(conversation.client_id));
    clientNotices += 1;
  }

  // 3. Vérification sans preuve du refus dans les 72 heures : restriction de 100 jours.
  const [late] = await pool.query(
    `SELECT v.reference FROM verification_requests v JOIN transactions t ON t.id = v.transaction_id
      WHERE v.status = 'open' AND t.status = 'verification_requested'
        AND v.evidence_due_at IS NOT NULL AND v.evidence_due_at <= UTC_TIMESTAMP()`,
  );
  for (const { reference } of late) {
    const result = await withTransaction(async (connection) => {
      const [[request]] = await connection.execute("SELECT * FROM verification_requests WHERE reference = ? AND status = 'open' LIMIT 1 FOR UPDATE", [reference]);
      if (!request) return null;
      return { request, ...(await closeVerification(connection, request, "no_evidence")) };
    });
    if (!result) continue;
    await AuditLog.record({ actorUserId: null, actorRole: "system", action: "verification.no_evidence", entityType: "verification_request", entityId: result.request.id });
    await announceVerification(result.request.conversation_id, "no_evidence", result.event, result.status);
    expired += 1;
  }
  return { reminders, clientNotices, expired };
}

async function conversationByRowId(id) {
  const [rows] = await pool.execute("SELECT public_id FROM conversations WHERE id = ?", [id]);
  return rows[0] ? Conversation.findByPublicId(rows[0].public_id) : null;
}
