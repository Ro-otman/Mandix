/**
 * Prépare le flux de notifications pour la vue : heure relative, groupes par période, onglets de filtre.
 * Entrée : [{ id, kind, actor?, icon?, tone?, title, body, rating?, date, unread, link, cta? }].
 */
import config from "../config/app.js";
import { avatarSvg } from "./avatar.js";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** Ordre et libellés des onglets par type ; seuls les types présents dans le flux sont affichés. */
const KINDS = [
  { key: "message", label: "Messages", icon: "message-circle", tone: "info" },
  { key: "review", label: "Avis", icon: "star", tone: "gold" },
  { key: "account", label: "Compte", icon: "landmark", tone: "warning" },
  { key: "security", label: "Sécurité", icon: "shield-check", tone: "success" },
];

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
const shortDate = new Intl.DateTimeFormat("fr-FR", { timeZone: config.timezone, day: "numeric", month: "short" });

/** « À l'instant », « Il y a 12 min », « Il y a 5 h », « Hier », « Il y a 3 j », puis « 8 nov. ». */
export function relativeTime(date, now = new Date()) {
  const minutes = Math.floor(Math.max(0, now - date) / MINUTE);
  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Hier";
  if (days < 7) return `Il y a ${days} j`;
  return shortDate.format(date);
}

function periodOf(date, now) {
  const key = dayKey.format(date);
  if (key === dayKey.format(now)) return "Aujourd'hui";
  if (key === dayKey.format(new Date(now - DAY))) return "Hier";
  if (now - date < 7 * DAY) return "Cette semaine";
  return "Plus ancien";
}

export function buildFeed(list, now = new Date()) {
  const items = [...list]
    .sort((a, b) => b.date - a.date)
    .map((n) => {
      const kind = KINDS.find((k) => k.key === n.kind) ?? KINDS[0];
      return {
        ...n,
        icon: n.icon ?? kind.icon,
        tone: n.tone ?? kind.tone,
        kindIcon: kind.icon,
        kindTone: kind.tone,
        actorAvatar: n.actor ? avatarSvg(n.actor.avatar, { size: 48 }) : null,
        when: relativeTime(n.date, now),
        iso: n.date.toISOString(),
      };
    });

  const groups = [];
  items.forEach((item) => {
    const label = periodOf(item.date, now);
    let group = groups.find((g) => g.label === label);
    if (!group) groups.push((group = { label, items: [] }));
    group.items.push(item);
  });

  const unread = items.filter((i) => i.unread).length;
  const tabs = [
    { key: "all", label: "Toutes" },
    { key: "unread", label: "Non lues", count: unread },
    ...KINDS.filter((k) => items.some((i) => i.kind === k.key)).map((k) => ({ key: k.key, label: k.label })),
  ];

  return { groups, tabs, unread, total: items.length };
}
