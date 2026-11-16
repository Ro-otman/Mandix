/**
 * Messagerie (données réelles) : pages Messages et panneaux latéraux des espaces client et mandataire,
 * envoi et lecture des fichiers joints, renouvellement des jetons pour la connexion temps réel.
 * L'envoi des messages eux-mêmes passe par socket.io (realtime/io.js).
 */
import { Router } from "express";
import multer from "multer";
import * as messaging from "../services/messagingService.js";
import * as notifications from "../services/notificationService.js";
import { renderSpace } from "../services/spaceService.js";
import { buildFeed } from "../utils/notifications.js";
import { requireAuth } from "../middlewares/authenticate.js";
import { uploadLimiter } from "../middlewares/rateLimiter.js";
import { notFound, HttpError } from "../utils/httpError.js";
import { avatarSvg } from "../utils/avatar.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4 } });
const ctx = (req) => ({ mandataire: req.mandataire ?? null, ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) ?? null });

/** Erreur métier de la messagerie → réponse JSON lisible. */
const asJson = (handler) => async (req, res, next) => {
  try {
    await handler(req, res);
  } catch (error) {
    if (error instanceof messaging.MessagingError) return res.status(error.status).json({ error: error.publicMessage });
    next(error);
  }
};

/* ------------------------------------------------------------------ Session (connexion temps réel) */

// Le jeton d'accès a été renouvelé par le middleware d'authentification : le navigateur peut se reconnecter.
router.get("/api/session", (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!req.currentUser) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, role: req.currentUser.role });
});

/* ------------------------------------------------------------------ Pages Messages */

const BASE = { client: "/client/messages", mandataire: "/mandataire/messages" };

function messagesPage(role) {
  return async (req, res, next) => {
    const basePath = BASE[role];
    let active = req.params.id ?? null;
    const view = await messaging.chatView(req.currentUser, { active, mandataire: req.mandataire, basePath });
    if (!view) return next(notFound("Conversation introuvable."));
    // Sans conversation choisie : la plus récente s'ouvre (sur mobile, la liste s'affiche d'abord).
    if (!active && view.list.length) {
      active = view.list[0].id;
      Object.assign(view, await messaging.chatView(req.currentUser, { active, mandataire: req.mandataire, basePath }));
    }
    await renderSpace(req, res, "messages", "Messages", { chat: view, chatRole: role, openedFromList: !req.params.id, basePath });
  };
}
router.get("/client/messages", messagesPage("client"));
router.get("/client/messages/:id", messagesPage("client"));
router.get("/mandataire/messages", messagesPage("mandataire"));
router.get("/mandataire/messages/:id", messagesPage("mandataire"));

/** Panneau latéral : uniquement chargé par le script (en-tête X-Mandix-Panel), sinon page complète. */
function panel(role, kind) {
  return async (req, res, next) => {
    const full = kind === "list" ? BASE[role] : `${BASE[role]}/${encodeURIComponent(req.params.id)}`;
    if (req.get("X-Mandix-Panel") !== "1") return res.redirect(full);
    const view = await messaging.chatView(req.currentUser, { active: kind === "list" ? null : req.params.id, mandataire: req.mandataire, basePath: BASE[role] });
    if (!view || (kind === "chat" && !view.thread)) return next(notFound());
    res.set("Cache-Control", "no-store");
    res.set("Vary", "X-Mandix-Panel");
    const locals = kind === "list" ? { list: view.list } : { t: view.thread };
    res.render(`${role}/panel-${kind === "list" ? "messages" : "chat"}`, { layout: false, avatarSvg, ...locals });
  };
}
router.get("/client/panneau/messages", panel("client", "list"));
router.get("/client/panneau/messages/:id", panel("client", "chat"));
router.get("/mandataire/panneau/messages", panel("mandataire", "list"));
router.get("/mandataire/panneau/messages/:id", panel("mandataire", "chat"));

/* ------------------------------------------------------------------ Notifications */

const NOTIF_BASE = { client: "/client/notifications", mandataire: "/mandataire/notifications" };

/** Fil de notifications au format de la vue (utils/notifications.js). */
async function feedFor(user) {
  const items = await notifications.list(user.id, 60);
  return buildFeed(items.map((n) => ({
    id: n.id, kind: String(n.type).split(".")[0], title: n.title, body: n.body || "", link: n.link, cta: n.cta,
    unread: !n.read, date: new Date(n.at),
  })));
}
for (const role of ["client", "mandataire"]) {
  router.get(NOTIF_BASE[role], async (req, res) => {
    await renderSpace(req, res, "notifications", "Notifications", { feed: await feedFor(req.currentUser) });
  });
  router.get(`/${role}/panneau/notifications`, async (req, res) => {
    if (req.get("X-Mandix-Panel") !== "1") return res.redirect(NOTIF_BASE[role]);
    res.set("Cache-Control", "no-store");
    res.set("Vary", "X-Mandix-Panel");
    res.render(`${role}/panel-notifications`, { layout: false, feed: await feedFor(req.currentUser) });
  });
}

router.post("/api/notifications/lu", requireAuth, asJson(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  res.json({ updated: await notifications.markRead(req.currentUser.id, ids), unread: await notifications.unreadCount(req.currentUser.id) });
}));

/* ------------------------------------------------------------------ Fichiers joints */

router.post(
  "/api/conversations/:id/fichiers",
  requireAuth,
  uploadLimiter,
  (req, res, next) => upload.single("fichier")(req, res, (error) => {
    if (error) return res.status(422).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Fichier trop lourd : 5 Mo au maximum." : "Envoi du fichier impossible." });
    next();
  }),
  asJson(async (req, res) => {
    if (!req.file) return res.status(422).json({ error: "Choisissez un fichier." });
    const result = await messaging.upload(req.currentUser, {
      conversationId: req.params.id, kind: req.body?.kind, buffer: req.file.buffer, originalName: req.file.originalname,
    }, ctx(req));
    res.status(201).json(result);
  }),
);

router.get("/fichiers/:id", requireAuth, async (req, res, next) => {
  try {
    const file = await messaging.readAttachment(req.currentUser, req.params.id, ctx(req));
    res.set({
      "Content-Type": file.mime,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
    res.send(file.buffer);
  } catch (error) {
    if (error instanceof messaging.MessagingError) return next(new HttpError(error.status, error.publicMessage));
    next(error);
  }
});

export default router;
