/**
 * Serveur temps réel (socket.io) : messagerie et notifications.
 *  - Authentification : le même jeton d'accès que le site (cookie HttpOnly, envoyé automatiquement par le
 *    navigateur) ; la session est revérifiée à chaque action (déconnexion, suspension : effet immédiat).
 *  - Origine contrôlée : une page d'un autre site ne peut pas ouvrir de connexion au nom de l'utilisateur.
 *  - Salons : « user:<id> » (notifications, aperçus de conversations) et « conv:<id> » (une conversation,
 *    rejoint uniquement après vérification que l'utilisateur y participe).
 *  - Limite : 40 actions par minute et par connexion.
 */
import { Server } from "socket.io";
import cookie from "cookie";
import config from "../config/app.js";
import pool from "../config/database.js";
import { verifyAccessToken, cookieNames, isSpace, spacesWithCookies, LAST_SPACE_COOKIE } from "../services/tokenService.js";
import { AuthSession } from "../models/AuthSession.js";
import { MandataireProfile } from "../models/MandataireProfile.js";
import { Conversation, ConversationEvent } from "../models/Messaging.js";
import * as messaging from "../services/messagingService.js";
import * as notifications from "../services/notificationService.js";
import { countsFor } from "../services/badgeService.js";
import * as hub from "./hub.js";

const RATE = { max: 40, windowMs: 60_000 };

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // requêtes de même origine sans en-tête Origin (le cookie reste exigé)
  try {
    const url = new URL(origin);
    return url.origin === new URL(config.baseUrl).origin || url.host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * Identité de la connexion temps réel. Le navigateur peut détenir une session par espace (client, mandataire…) :
 * la page indique son espace (auth.space, lu dans <meta name="mandix-space">) et seule la session de cet espace
 * est utilisée. Sans indication : dernier espace visité, puis les autres.
 */
async function loadIdentity(handshake) {
  const cookies = cookie.parse(handshake.headers.cookie || "");
  const asked = handshake.auth?.space;
  const available = spacesWithCookies(cookies);
  const last = cookies[LAST_SPACE_COOKIE];
  const order = isSpace(asked)
    ? [asked]
    : isSpace(last) && available.includes(last) ? [last, ...available.filter((s) => s !== last)] : available;
  for (const space of order) {
    const payload = await verifyAccessToken(cookies[cookieNames(space).access]);
    if (!payload) continue;
    const row = await AuthSession.findActiveWithUser(payload.sid);
    if (!row || row.public_id !== payload.sub || row.role !== space) continue;
    const user = { id: Number(row.id), role: row.role, pseudo: row.pseudo, publicId: row.public_id };
    return { user, sessionPublicId: row.session_public_id };
  }
  return null;
}

const touchLastSeen = (userId) => pool.execute("UPDATE users SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?", [userId]).catch(() => {});

export function createRealtime(httpServer) {
  const io = new Server(httpServer, {
    serveClient: false,
    maxHttpBufferSize: 64 * 1024, // les fichiers passent par HTTP, jamais par le socket
    allowRequest: (req, callback) => callback(null, sameOrigin(req)),
    cors: { origin: new URL(config.baseUrl).origin, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const identity = await loadIdentity({ headers: socket.request.headers, auth: socket.handshake.auth });
      if (!identity) {
        const error = new Error("auth");
        error.data = { code: "auth" }; // le navigateur renouvelle ses jetons puis se reconnecte
        return next(error);
      }
      socket.data.user = identity.user;
      socket.data.sessionPublicId = identity.sessionPublicId;
      if (identity.user.role === "mandataire") socket.data.mandataire = await MandataireProfile.findByUserId(identity.user.id);
      socket.data.hits = [];
      next();
    } catch (error) {
      console.error("[socket] authentification :", error.message);
      next(new Error("server"));
    }
  });

  io.on("connection", (socket) => {
    const { user } = socket.data;
    socket.join(`user:${user.id}`);
    touchLastSeen(user.id);

    /** Enveloppe commune : limite de débit, session toujours valide, erreurs lisibles, accusé de réception. */
    const on = (name, handler) => {
      socket.on(name, async (payload, ack) => {
        const reply = typeof ack === "function" ? ack : () => {};
        const now = Date.now();
        socket.data.hits = socket.data.hits.filter((t) => now - t < RATE.windowMs);
        if (socket.data.hits.length >= RATE.max) return reply({ ok: false, error: "Trop d'actions en peu de temps : patientez un instant." });
        socket.data.hits.push(now);
        try {
          const session = await AuthSession.findActiveWithUser(socket.data.sessionPublicId);
          if (!session) {
            reply({ ok: false, error: "Session expirée : reconnectez-vous.", code: "auth" });
            return socket.disconnect(true);
          }
          reply({ ok: true, ...(await handler(payload && typeof payload === "object" ? payload : {})) });
        } catch (error) {
          if (!(error instanceof messaging.MessagingError)) console.error(`[socket] ${name} :`, error);
          reply({ ok: false, error: error.publicMessage || "Une erreur est survenue. Réessayez." });
        }
      });
    };
    const context = { mandataire: socket.data.mandataire ?? null, ip: socket.handshake.address, userAgent: socket.handshake.headers["user-agent"]?.slice(0, 255) ?? null };

    on("conversation:join", async ({ conversationId }) => {
      const conversation = await Conversation.findByPublicId(conversationId);
      await messaging.participation(user, conversation, context.mandataire);
      socket.join(`conv:${conversation.public_id}`);
      return { events: await ConversationEvent.list(conversation.id) };
    });

    on("message:send", async ({ conversationId, mandataireSlug, type, data }) => {
      const result = await messaging.act(user, { conversationId, mandataireSlug, type, data }, context);
      socket.join(`conv:${result.conversation.public_id}`);
      return { event: result.event, status: result.status, conversationId: result.conversation.public_id };
    });

    on("review:submit", async ({ conversationId, rating, appreciation }) => messaging.review(user, { conversationId, rating, appreciation }, context));

    on("conversation:read", async ({ conversationId }) => {
      await messaging.markRead(user, conversationId, context);
      return {};
    });

    on("notifications:read", async ({ ids }) => ({ updated: await notifications.markRead(user.id, Array.isArray(ids) ? ids : null) }));

    // Compteurs exacts à la demande : connexion, reconnexion, onglet qui redevient visible.
    on("badges:get", async () => countsFor(user, context.mandataire?.id ?? null));

    socket.on("disconnect", () => touchLastSeen(user.id));
  });

  hub.attach(io);
  return io;
}
