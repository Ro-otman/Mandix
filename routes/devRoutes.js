/** Pages de développement : montées uniquement hors production (voir routes/index.js). */
import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { dashboardMenus } from "../config/navigation.js";
import { OUTBOX_DIR, inlineCidImages } from "../config/mailer.js";
import { previewMessage } from "../services/mailService.js";

const router = Router();

const PREVIEWS = {
  client: {
    heading: "Bonjour",
    stats: [
      { label: "Demandes en cours", icon: "inbox" },
      { label: "Rendez-vous à venir", icon: "calendar" },
      { label: "Prestations terminées", icon: "circle-check" },
      { label: "Notifications", icon: "bell" },
    ],
  },
  mandataire: {
    heading: "Votre activité",
    stats: [
      { label: "Demandes reçues", icon: "inbox" },
      { label: "En attente", icon: "clock" },
      { label: "Rendez-vous à venir", icon: "calendar" },
      { label: "Statut de vérification", icon: "file-check" },
    ],
  },
  admin: {
    heading: "Vue d'ensemble",
    stats: [
      { label: "Clients", icon: "users" },
      { label: "Mandataires vérifiés", icon: "user-check" },
      { label: "Vérifications en attente", icon: "file-check" },
      { label: "Réclamations ouvertes", icon: "message-square-text" },
    ],
  },
};

router.get("/styleguide", (req, res) => {
  res.render("dev/styleguide", { title: "Guide de style", extraStyles: ["dev"] });
});

router.get("/dashboard", (req, res) => {
  const role = Object.hasOwn(dashboardMenus, req.query.role) ? req.query.role : "client";
  res.render("dev/dashboard-preview", {
    layout: "layouts/dashboard",
    extraStyles: ["dev"],
    title: "Aperçu du tableau de bord",
    dashboardRole: role,
    previewHeading: PREVIEWS[role].heading,
    previewStats: PREVIEWS[role].stats,
  });
});


/* E-mails de développement (SMTP non configuré) : liste des derniers envois et affichage de chacun. */
router.get("/emails", async (req, res) => {
  let files = [];
  try {
    files = (await fs.readdir(OUTBOX_DIR)).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, 50);
  } catch {
    files = [];
  }
  const emails = [];
  for (const file of files) {
    try {
      const meta = JSON.parse(await fs.readFile(path.join(OUTBOX_DIR, file), "utf8"));
      emails.push({ id: file.replace(/\.json$/, ""), to: meta.to, subject: meta.subject, date: meta.date });
    } catch {
      /* fichier illisible : ignoré */
    }
  }
  res.render("dev/emails", { title: "E-mails de développement", emails });
});

const EMAIL_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; frame-ancestors 'none'";

/* Aperçu des modèles d'e-mails (exemples fictifs, aucun envoi). */
router.get("/emails/apercu/:kind", async (req, res, next) => {
  const message = await previewMessage(req.params.kind);
  if (!message) return next();
  res.set("Content-Security-Policy", EMAIL_CSP);
  res.type("html").send(await inlineCidImages(message.html, message.attachments));
});

router.get("/emails/:id", async (req, res, next) => {
  if (!/^[A-Za-z0-9-]{10,80}$/.test(req.params.id)) return next();
  try {
    const html = await fs.readFile(path.join(OUTBOX_DIR, `${req.params.id}.html`), "utf8");
    // Les e-mails utilisent des styles en ligne : politique dédiée à cette page de développement, sans script.
    res.set("Content-Security-Policy", EMAIL_CSP);
    res.type("html").send(html);
  } catch {
    next();
  }
});

export default router;
