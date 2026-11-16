/**
 * Messagerie guidée en temps réel (client ↔ mandataire), côté serveur.
 *
 * Le serveur est seul juge du parcours : chaque action est revalidée ici (bon rôle, bonne étape, montant sous le
 * plafond, option attendue, pièce jointe appartenant à la transaction…), quel que soit ce que le navigateur envoie.
 * L'étape en cours est la colonne transactions.status ; les messages en sont la trace lisible.
 *
 * Messages éphémères et chiffrés : contenu chiffré (AES-256-GCM) ; effacés, avec leurs fichiers, 3 jours après la
 * clôture de leur transaction (une transaction en cours garde ses messages : délai de 7 jours, vérification Mandix).
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
import { countryName } from "../content/countries.js";
import { appreciationsFor } from "../content/reviews.js";
import { EUR_RATES, limitForTransactions, limitLabel } from "../utils/limits.js";
import { CERTIFICATION_THRESHOLD } from "../utils/badges.js";
import { sensitiveReason } from "../utils/sensitive.js";
import { avatarSvg, defaultAvatarSpec } from "../utils/avatar.js";
import { presence } from "../utils/presence.js";
import { eventText, PENDING_MAX_DAYS } from "./chatFlow.js";
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
    `SELECT pm.id, pm.slug, pm.pseudo, pm.transactions_count, pm.is_verified, pm.last_seen_at, mp.user_id
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
    credit_proof_request: `${name} demande une preuve de non-crédit`,
    credit_proof: `${name} a envoyé ses preuves`,
    credit_proof_ok: `${name} a vérifié vos preuves`,
    verification_request: `${name} a demandé une vérification à Mandix`,
    payout_info: `${name} a indiqué son compte de réception`,
    sent: `${name} a envoyé l'argent`,
    receipt: data.received ? `${name} a bien reçu l'argent` : `${name} n'a pas encore reçu l'argent`,
  };
  if (!titles[type]) return null;
  return { title: titles[type], body: eventText({ type, data }), link, cta: "Ouvrir la conversation", type: `message.${type}` };
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
        const limitEur = limitForTransactions(Number(conversation.transactions_count) || 0);
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
        const status = data.status;
        const allowed = { pending: ["proof_review"], rejected: ["proof_review", "proof_pending"], validated: ["proof_review", "proof_pending", "credit_evidence_requested", "credit_evidence_sent", "under_verification", "disputed"] }[status];
        if (!allowed) fail("Décision inconnue.", 422);
        expect("mandataire", ...allowed);
        const proofEventId = await lastProofEvent(transactionId, connection);
        const [proofFile] = proofEventId ? (await connection.execute("SELECT id FROM attachments WHERE event_id = ? LIMIT 1", [proofEventId]))[0] : [];
        if (proofFile) await Attachment.decide(proofFile.id, status, connection);
        update = status === "validated" ? { status: "awaiting_payout_details", proof_validated_at: "NOW" }
          : status === "rejected" ? { status: "awaiting_proof", proof_rejections: "INCREMENT" }
            : { status: "proof_pending", proof_pending_since: "NOW" };
        payload = { status, proofId: proofEventId ? String(proofEventId) : null };
        break;
      }
      case "credit_proof_request": {
        expect("client", "proof_pending");
        const since = tx.proof_pending_since ? new Date(tx.proof_pending_since).getTime() : Date.now();
        if (Date.now() < since + PENDING_MAX_DAYS * DAY_MS) fail("Le délai de 7 jours n'est pas encore écoulé.", 409);
        update = { status: "credit_evidence_requested" };
        break;
      }
      case "credit_proof": {
        expect("mandataire", "credit_evidence_requested");
        const ids = Array.isArray(data.attachmentIds) ? [...new Set(data.attachmentIds.filter(isInt).map(Number))].slice(0, 5) : [];
        if (!ids.length) fail("Joignez au moins une capture.", 422);
        attachments = await Attachment.findUnlinked(ids, { transactionId, userId: user.id, kind: "credit_evidence" }, connection);
        if (attachments.length !== ids.length) fail("Une des captures est introuvable : envoyez-les de nouveau.", 422);
        update = { status: "credit_evidence_sent" };
        payload = { files: attachments.map(fileView) };
        break;
      }
      case "credit_proof_ok":
        expect("client", "credit_evidence_sent");
        update = { status: "proof_pending", proof_pending_since: "NOW" };
        break;
      case "verification_request":
        expect("client", "credit_evidence_sent");
        update = { status: "under_verification" };
        break;
      case "payout_info": {
        expect("client", "awaiting_payout_details");
        const types = await accountTypeIds();
        const type = typeof data.accountType === "string" ? types.get(data.accountType) : null;
        if (!type) fail("Choisissez le compte sur lequel recevoir l'argent.", 422);
        const receive = typeof data.receive === "string" ? data.receive.trim().replace(/\s+/g, " ") : "";
        if (receive.length < 3 || receive.length > 200) fail("Indiquez les coordonnées de réception (3 à 200 caractères).", 422);
        const reason = sensitiveReason(receive);
        if (reason) fail(reason, 422);
        const option = optionFor(data.accountType, data.option);
        update = {
          status: "awaiting_transfer", payout_account_type_id: type.id, payout_option: option.option ?? null,
          payout_details_enc: Transaction.encryptPayout(transactionId, receive),
        };
        payload = { accountType: data.accountType, accountName: type.name, receive, ...option };
        break;
      }
      case "sent": {
        expect("mandataire", "awaiting_transfer");
        if (!isInt(data.attachmentId)) fail("Joignez la capture du transfert.", 422);
        attachments = await Attachment.findUnlinked([Number(data.attachmentId)], { transactionId, userId: user.id, kind: "transfer_proof" }, connection);
        if (!attachments.length) fail("Capture introuvable : envoyez de nouveau le fichier.", 422);
        update = { status: "awaiting_receipt", transfer_sent_at: "NOW" };
        payload = { accountName: tx.payout_name, again: Boolean(tx.transfer_sent_at), ...fileView(attachments[0]) };
        break;
      }
      case "receipt": {
        const received = data.received === true;
        if (received) expect("client", "awaiting_receipt", "awaiting_transfer");
        else expect("client", "awaiting_receipt");
        if (received && tx.status === "awaiting_transfer" && !tx.transfer_sent_at) fail("Le mandataire n'a pas encore envoyé l'argent.", 409);
        update = received ? { status: "awaiting_review", receipt_confirmed_at: "NOW" } : { status: "awaiting_transfer" };
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
    if (type === "verification_request") {
      const reference = `VR-${new Date().getUTCFullYear()}-${String(event.id).padStart(6, "0")}`;
      await connection.execute(
        `INSERT INTO verification_requests (reference, transaction_id, conversation_id, client_id, mandataire_id, request_event_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [reference, transactionId, conversation.id, conversation.client_id, conversation.mandataire_id, event.id],
      );
    }
    await Conversation.touch(conversation.id, connection);
    return { event, status: update.status ?? (type === "request" ? "requested" : tx?.status ?? null) };
  });

  if (["request", "verification_request"].includes(type)) {
    await AuditLog.record({ actorUserId: user.id, actorRole: role, action: `conversation.${type}`, entityType: "conversation", entityId: conversation.id, ip, userAgent });
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
  if (event.type === "verification_request") await pushAdminBadges();
}

/* ------------------------------------------------------------------ Évaluation (hors messages) */

/**
 * Évaluation obligatoire du client : clôt la transaction, met à jour la note et le nombre de transactions du
 * mandataire (plafond, certification). Elle n'est pas un message et n'est pas envoyée au mandataire.
 */
export async function review(user, { conversationId, rating, appreciation }, { ip = null, userAgent = null } = {}) {
  const conversation = await Conversation.findByPublicId(conversationId);
  const { role } = await participation(user, conversation);
  if (role !== "client") fail("Seul le client évalue la transaction.", 403);
  const note = Number(rating);
  if (!Number.isInteger(note) || note < 1 || note > 5) fail("Choisissez une note de 1 à 5.", 422);
  if (!appreciationsFor(note).some(([key]) => key === appreciation)) fail("Choisissez une appréciation.", 422);

  const transactionId = await withTransaction(async (connection) => {
    const tx = await Transaction.findOpen(conversation.id, connection, { lock: true });
    if (!tx || tx.status !== "awaiting_review") fail("Cette transaction ne peut pas être évaluée.", 409);
    await connection.execute(
      "INSERT INTO reviews (transaction_id, client_id, mandataire_id, rating, appreciation) VALUES (?, ?, ?, ?, ?)",
      [tx.id, user.id, conversation.mandataire_id, note, appreciation],
    );
    await Transaction.update(tx.id, { status: "completed", completed_at: "NOW" }, connection);
    await connection.execute(
      `UPDATE mandataire_profiles
          SET rating_avg = ROUND(((COALESCE(rating_avg, 0) * rating_count) + ?) / (rating_count + 1), 2),
              rating_count = rating_count + 1,
              transactions_count = transactions_count + 1,
              certified_at = IF(certified_at IS NULL AND transactions_count >= ?, UTC_TIMESTAMP(), certified_at)
        WHERE id = ?`,
      [note, CERTIFICATION_THRESHOLD, conversation.mandataire_id],
    );
    return Number(tx.id);
  });
  await AuditLog.record({ actorUserId: user.id, actorRole: "client", action: "transaction.review", entityType: "transaction", entityId: transactionId, metadata: { rating: note }, ip, userAgent });
  hub.toConversation(conversation.public_id, "transaction:closed", { conversationId: conversation.public_id, status: "completed" });
  return { transactionId };
}

/* ------------------------------------------------------------------ Pièces jointes */

const UPLOAD_RULES = {
  payment_proof: { role: "client", statuses: ["awaiting_proof"] },
  transfer_proof: { role: "mandataire", statuses: ["awaiting_transfer"] },
  credit_evidence: { role: "mandataire", statuses: ["credit_evidence_requested"] },
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

const PAYOUT_TYPES = ACCOUNT_TYPES.map((t) => ({ slug: t.slug, name: t.name, logo: t.logo, receiveLabel: t.receiveLabel, receivePlaceholder: t.receivePlaceholder, options: t.options ?? null }));

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
    const transactions = conversation ? Number(conversation.transactions_count) : Number(target.transactions_count);
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
        payoutTypes: PAYOUT_TYPES,
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
 * Efface les messages (et leurs fichiers) des transactions clôturées depuis plus de 3 jours.
 * Les transactions elles-mêmes sont conservées (plafond, statistiques, évaluations), sans coordonnées.
 */
export async function purgeExpiredMessages() {
  const days = config.messages.retentionDays;
  const closed = `SELECT id FROM transactions WHERE status IN ('completed','cancelled')
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
 * Décision de l'équipe sur des preuves de non-crédit contestées : preuves authentiques (le délai de 7 jours
 * repart) ou non conformes (litige). Un message « Équipe Mandix » est publié dans la conversation et les deux
 * parties sont notifiées. Si le mandataire a validé le paiement entre-temps, la demande est simplement close.
 */
export async function decideVerification(admin, reference, decision, { ip = null, userAgent = null } = {}) {
  if (!["authentic", "not_authentic"].includes(decision)) fail("Décision inconnue.", 422);
  const result = await withTransaction(async (connection) => {
    const [[request]] = await connection.execute("SELECT * FROM verification_requests WHERE reference = ? LIMIT 1 FOR UPDATE", [String(reference)]);
    if (!request) fail("Demande introuvable.", 404);
    if (request.status !== "open") fail("Cette demande a déjà été traitée.", 409);
    await connection.execute(
      "UPDATE verification_requests SET status = ?, decided_by = ?, decided_at = UTC_TIMESTAMP() WHERE id = ?",
      [decision, admin.id, request.id],
    );
    const tx = await Transaction.findById(request.transaction_id, connection);
    if (!tx || tx.status !== "under_verification") return { request, event: null, status: tx?.status ?? null };
    const status = decision === "authentic" ? "proof_pending" : "disputed";
    await Transaction.update(tx.id, decision === "authentic" ? { status, proof_pending_since: "NOW" } : { status }, connection);
    const event = await ConversationEvent.create(
      { conversationId: request.conversation_id, transactionId: tx.id, role: "system", userId: null, type: "verification_result", data: { authentic: decision === "authentic" } },
      connection,
    );
    await Conversation.touch(request.conversation_id, connection);
    return { request, event, status };
  });

  await AuditLog.record({ actorUserId: admin.id, actorRole: "admin", action: `verification.${decision}`, entityType: "verification_request", entityId: result.request.id, ip, userAgent });
  if (!result.event) {
    await pushAdminBadges(); // demande close : compteur « Vérifications » de l'équipe à jour
    return { closedOnly: true };
  }
  const [rows] = await pool.execute("SELECT public_id FROM conversations WHERE id = ?", [result.request.conversation_id]);
  const conversation = await Conversation.findByPublicId(rows[0]?.public_id);
  hub.toConversation(conversation.public_id, "message:new", { conversationId: conversation.public_id, event: result.event, status: result.status });
  const title = decision === "authentic" ? "Vérification Mandix : preuves authentiques" : "Vérification Mandix : preuves non conformes";
  const body = eventText(result.event);
  await notifications.notify(Number(conversation.client_id), { type: "message.verification_result", title, body, link: `/client/messages/${conversation.mandataire_slug}`, cta: "Ouvrir la conversation" });
  await notifications.notify(Number(conversation.mandataire_user_id), { type: "message.verification_result", title, body, link: `/mandataire/messages/${conversation.public_id}`, cta: "Ouvrir la conversation" });
  await pushBadges(Number(conversation.client_id), Number(conversation.mandataire_user_id));
  await pushAdminBadges();
  return { closedOnly: false };
}
