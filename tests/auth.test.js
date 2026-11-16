/**
 * Tests de bout en bout de l'authentification (inscription → confirmation → connexion → rafraîchissement →
 * détection de vol → déconnexion → mot de passe oublié → réinitialisation), sur une base MySQL TEMPORAIRE
 * créée puis supprimée par le test (identifiants MySQL lus dans .env). La base de travail n'est jamais touchée.
 * Usage : npm test
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDb = `mandix_test_${process.pid}`;
const outbox = await fs.mkdtemp(path.join(os.tmpdir(), "mandix-mails-"));

// Configuration de test, posée AVANT le chargement de l'application (dotenv ne remplace pas ces valeurs).
process.env.DB_NAME = testDb;
process.env.MAIL_OUTBOX_DIR = outbox;
process.env.APP_BASE_URL = "http://mandix.test";
process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";

let server;
let base;
let db;
let mysql;

/* ------------------------------------------------------------------ Outils */

class CookieJar {
  constructor() { this.cookies = new Map(); }
  store(response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const attrs = attributes.map((a) => a.trim().toLowerCase());
      const expired = attrs.some((a) => a === "max-age=0" || (a.startsWith("expires=") && new Date(a.slice(8)) < new Date()));
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, { value, attrs });
    }
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v.value}`).join("; "); }
  get(name) { return this.cookies.get(name); }
  delete(name) { this.cookies.delete(name); }
  set(name, value) { this.cookies.set(name, { value, attrs: [] }); }
}

async function http(jar, method, pathname, form) {
  const headers = { cookie: jar.header() };
  let body;
  if (form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  }
  const response = await fetch(base + pathname, { method, headers, body, redirect: "manual" });
  jar.store(response);
  return { status: response.status, location: response.headers.get("location"), text: await response.text(), headers: response.headers };
}

const csrfOf = (html) => html.match(/name="_csrf" value="([^"]+)"/)?.[1];

/** Ouvre une page, récupère le jeton CSRF du formulaire, puis envoie le formulaire. */
async function submit(jar, pagePath, actionPath, fields) {
  const page = await http(jar, "GET", pagePath);
  const token = csrfOf(page.text);
  assert.ok(token, `jeton CSRF introuvable sur ${pagePath}`);
  return http(jar, "POST", actionPath, { _csrf: token, ...fields });
}

/** Dernier lien envoyé à une adresse (e-mails enregistrés dans le dossier de test). */
async function lastLink(email, kind) {
  for (let i = 0; i < 40; i += 1) {
    const files = (await fs.readdir(outbox)).filter((f) => f.endsWith(".json")).sort().reverse();
    for (const file of files) {
      const mail = JSON.parse(await fs.readFile(path.join(outbox, file), "utf8"));
      const match = mail.to === email && mail.text.match(new RegExp(`https?://[^\\s]+/${kind}/([A-Za-z0-9_-]+)`));
      if (match) return new URL(match[0]).pathname;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}
const mailCount = async (email) => {
  let n = 0;
  for (const file of (await fs.readdir(outbox)).filter((f) => f.endsWith(".json"))) {
    if (JSON.parse(await fs.readFile(path.join(outbox, file), "utf8")).to === email) n += 1;
  }
  return n;
};

const ACCESS = "mandix.at.client"; // une paire de cookies par espace
const REFRESH = "mandix.rt.client";
const STRONG = "Baobab-Lagune-2026";
const STRONG_2 = "Pirogue#Marche-77z";

/* ------------------------------------------------------------------ Mise en place */

before(async () => {
  execFileSync(process.execPath, [path.join(root, "scripts", "db-setup.js")], { env: process.env, stdio: "ignore" });
  mysql = (await import("mysql2/promise")).default;
  const config = (await import("../config/app.js")).default;
  db = await mysql.createConnection({ ...config.db, database: testDb, timezone: "Z" });
  const app = (await import("../app.js")).default;
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  const pool = (await import("../config/database.js")).default;
  await pool.end().catch(() => {});
  if (db) {
    await db.query(`DROP DATABASE IF EXISTS \`${testDb}\``);
    await db.end();
  }
  await fs.rm(outbox, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ Parcours */

test("inscription, confirmation de l'adresse et connexion", async () => {
  const jar = new CookieJar();
  const email = "awa@exemple.com";

  // Sans jeton CSRF : refus.
  const noCsrf = await http(jar, "POST", "/inscription", { pseudo: "AwaTest", email, password: STRONG, passwordConfirm: STRONG, terms: "on" });
  assert.equal(noCsrf.status, 403);

  // Mot de passe trop faible : refusé par le serveur, le pseudo et l'e-mail sont conservés.
  const weak = await submit(jar, "/inscription", "/inscription", { pseudo: "AwaTest", email, password: "motdepasse123", passwordConfirm: "motdepasse123", terms: "on" });
  assert.equal(weak.status, 422);
  assert.match(weak.text, /trop facile à deviner/);
  assert.match(weak.text, /value="AwaTest"/);
  assert.doesNotMatch(weak.text, /motdepasse123/, "le mot de passe n'est jamais réaffiché");

  const ok = await submit(jar, "/inscription", "/inscription", { pseudo: "AwaTest", email, password: STRONG, passwordConfirm: STRONG, terms: "on" });
  assert.equal(ok.status, 303);
  assert.equal(ok.location, "/verification-email");
  const [[user]] = await db.query("SELECT id, status, role, password_hash FROM users WHERE email = ?", [email]);
  assert.equal(user.status, "pending_email");
  assert.equal(user.role, "client");
  assert.match(user.password_hash, /^\$argon2id\$/);

  // Pseudo déjà pris (autre adresse) : message explicite.
  const taken = await submit(jar, "/inscription", "/inscription", { pseudo: "awatest", email: "autre@exemple.com", password: STRONG, passwordConfirm: STRONG, terms: "on" });
  assert.equal(taken.status, 422);
  assert.match(taken.text, /pseudo est déjà pris/);

  // Adresse déjà utilisée : même réponse qu'une inscription réussie (aucune révélation).
  const same = await submit(jar, "/inscription", "/inscription", { pseudo: "Awa2", email, password: STRONG, passwordConfirm: STRONG, terms: "on" });
  assert.equal(same.status, 303);
  assert.equal(same.location, "/verification-email");

  // Connexion avant confirmation : refusée avec explication (mot de passe correct).
  const early = await submit(jar, "/connexion", "/connexion", { email, password: STRONG });
  assert.equal(early.status, 403);
  assert.match(early.text, /Confirmez d(&#39;|')abord votre adresse/);

  const link = await lastLink(email, "verification-email");
  assert.ok(link, "lien de confirmation envoyé");
  const confirm = await http(jar, "GET", link);
  assert.equal(confirm.status, 303);
  assert.equal(confirm.location, "/connexion");
  const [[after1]] = await db.query("SELECT status, email_verified_at FROM users WHERE id = ?", [user.id]);
  assert.equal(after1.status, "active");
  assert.ok(after1.email_verified_at);

  // Lien rejoué : « déjà confirmée », pas d'erreur.
  const again = await http(jar, "GET", link);
  assert.equal(again.status, 303);
  const flashPage = await http(jar, "GET", "/connexion");
  assert.match(flashPage.text, /déjà confirmée/);

  // Mauvais mot de passe : message générique.
  const wrong = await submit(jar, "/connexion", "/connexion", { email, password: "PasLeBon-123456" });
  assert.equal(wrong.status, 401);
  assert.match(wrong.text, /Adresse e-mail ou mot de passe incorrect/);

  // Connexion « Rester connecté » : deux cookies HttpOnly, redirection vers l'espace client.
  const login = await submit(jar, "/connexion", "/connexion", { email, password: STRONG, remember: "on" });
  assert.equal(login.status, 303);
  assert.equal(login.location, "/client/dashboard");
  assert.ok(jar.get(ACCESS)?.attrs.includes("httponly"));
  assert.ok(jar.get(REFRESH)?.attrs.includes("httponly"));
  assert.ok(jar.get(REFRESH).attrs.some((a) => a.startsWith("max-age=")), "cookie persistant avec « Rester connecté »");

  const space = await http(jar, "GET", "/client/dashboard");
  assert.equal(space.status, 200);
  assert.match(space.text, /AwaTest/);

  // Espace d'un autre rôle : pas de session pour cet espace → connexion à cet espace (onglet Professionnel).
  const other = await http(jar, "GET", "/mandataire/comptes");
  assert.equal(other.status, 302);
  assert.equal(other.location, "/connexion?suite=%2Fmandataire%2Fcomptes");

  // Page de connexion pour un utilisateur déjà connecté : renvoi vers son espace.
  const guest = await http(jar, "GET", "/connexion");
  assert.equal(guest.status, 302);
  assert.equal(guest.location, "/client/dashboard");
});

test("rafraîchissement des jetons, tolérance et détection de vol", async () => {
  const jar = new CookieJar();
  const login = await submit(jar, "/connexion", "/connexion", { email: "awa@exemple.com", password: STRONG });
  assert.equal(login.status, 303);
  assert.ok(!jar.get(REFRESH).attrs.some((a) => a.startsWith("max-age=")), "cookie de session sans « Rester connecté »");

  // Jeton d'accès expiré (supprimé) : le jeton de rafraîchissement est échangé, en toute transparence.
  const oldRefresh = jar.get(REFRESH).value;
  jar.delete(ACCESS);
  const refreshed = await http(jar, "GET", "/client/dashboard");
  assert.equal(refreshed.status, 200);
  assert.ok(jar.get(ACCESS), "nouveau jeton d'accès");
  assert.notEqual(jar.get(REFRESH).value, oldRefresh, "jeton de rafraîchissement renouvelé (rotation)");

  // Requête simultanée avec l'ancien jeton (moins de 30 s) : tolérée, sans nouvelle rotation.
  const racer = new CookieJar();
  racer.set(REFRESH, oldRefresh);
  const race = await http(racer, "GET", "/client/dashboard");
  assert.equal(race.status, 200);

  // Ancien jeton rejoué après le délai de tolérance : vol présumé, toute la session est fermée.
  await db.query("UPDATE auth_refresh_tokens SET rotated_at = rotated_at - INTERVAL 5 MINUTE WHERE rotated_at IS NOT NULL");
  const thief = new CookieJar();
  thief.set(REFRESH, oldRefresh);
  const stolen = await http(thief, "GET", "/client/dashboard");
  assert.equal(stolen.status, 302);
  assert.match(stolen.location, /^\/connexion/);
  const [[session]] = await db.query("SELECT revoked_reason FROM auth_sessions ORDER BY id DESC LIMIT 1");
  assert.equal(session.revoked_reason, "reuse_detected");
  const [[audit]] = await db.query("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'auth.refresh_reuse'");
  assert.equal(audit.n, 1);

  // Le titulaire légitime est lui aussi déconnecté (même avec son jeton le plus récent).
  jar.delete(ACCESS);
  const victim = await http(jar, "GET", "/client/dashboard");
  assert.equal(victim.status, 302);
});

test("jetons falsifiés et redirections externes refusés", async () => {
  const jar = new CookieJar();
  await submit(jar, "/connexion", "/connexion", { email: "awa@exemple.com", password: STRONG });
  const access = jar.get(ACCESS).value;
  const [header, payload, signature] = access.split(".");

  // Signature modifiée.
  const forged = new CookieJar();
  forged.set(ACCESS, `${header}.${payload}.${signature.slice(0, -2)}xx`);
  assert.equal((await http(forged, "GET", "/client/dashboard")).status, 302);

  // Algorithme « none ».
  const none = new CookieJar();
  const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  none.set(ACCESS, `${noneHeader}.${payload}.`);
  assert.equal((await http(none, "GET", "/client/dashboard")).status, 302);

  // Redirection après connexion : jamais vers un autre site.
  for (const suite of ["https://pirate.example", "//pirate.example", "/\\pirate.example", "/mandataire/comptes"]) {
    const j = new CookieJar();
    const res = await submit(j, "/connexion", "/connexion", { email: "awa@exemple.com", password: STRONG, suite });
    assert.equal(res.status, 303);
    assert.equal(res.location, "/client/dashboard", `suite=${suite}`);
  }
  const j = new CookieJar();
  const res = await submit(j, "/connexion", "/connexion", { email: "awa@exemple.com", password: STRONG, suite: "/client/messages/moussa-diop" });
  assert.equal(res.location, "/client/messages/moussa-diop");
});

test("déconnexion : session révoquée immédiatement", async () => {
  const jar = new CookieJar();
  await submit(jar, "/connexion", "/connexion", { email: "awa@exemple.com", password: STRONG });
  const stolenAccess = jar.get(ACCESS).value;

  const page = await http(jar, "GET", "/client/dashboard");
  const logout = await http(jar, "POST", "/deconnexion", { _csrf: csrfOf(page.text) });
  assert.equal(logout.status, 303);
  assert.equal(logout.location, "/connexion");
  assert.equal(jar.get(ACCESS), undefined, "cookies effacés");

  // Un jeton d'accès copié avant la déconnexion, encore valable 15 min, ne sert plus à rien.
  const copy = new CookieJar();
  copy.set(ACCESS, stolenAccess);
  assert.equal((await http(copy, "GET", "/client/dashboard")).status, 302);
});

test("mot de passe oublié et réinitialisation", async () => {
  const email = "awa@exemple.com";
  const jar = new CookieJar();

  // Une session ouverte ailleurs, qui doit être fermée par la réinitialisation.
  const elsewhere = new CookieJar();
  await submit(elsewhere, "/connexion", "/connexion", { email, password: STRONG });

  const known = await submit(jar, "/mot-de-passe-oublie", "/mot-de-passe-oublie", { email });
  const unknown = await submit(jar, "/mot-de-passe-oublie", "/mot-de-passe-oublie", { email: "personne@exemple.com" });
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  // On retire l'adresse masquée (seule différence légitime) et le jeton CSRF avant de comparer.
  const strip = (html) => html.replace(/[^\s>]•+@[^\s<,]+/g, "").replace(/name="_csrf" value="[^"]+"/g, "");
  assert.equal(strip(known.text), strip(unknown.text), "réponse identique qu'un compte existe ou non");
  assert.equal(await mailCount("personne@exemple.com"), 0);

  const link = await lastLink(email, "reinitialisation");
  assert.ok(link);
  assert.equal((await http(jar, "GET", link)).status, 200);

  const weak = await submit(jar, link, link, { password: "azerty12345", passwordConfirm: "azerty12345" });
  assert.equal(weak.status, 422);

  const reset = await submit(jar, link, link, { password: STRONG_2, passwordConfirm: STRONG_2 });
  assert.equal(reset.status, 303);
  assert.equal(reset.location, "/connexion");

  // Lien à usage unique ; toutes les sessions fermées ; l'ancien mot de passe ne fonctionne plus.
  assert.equal((await http(jar, "GET", link)).status, 400);
  elsewhere.delete(ACCESS);
  assert.equal((await http(elsewhere, "GET", "/client/dashboard")).status, 302);
  assert.equal((await submit(jar, "/connexion", "/connexion", { email, password: STRONG })).status, 401);
  assert.equal((await submit(jar, "/connexion", "/connexion", { email, password: STRONG_2 })).status, 303);
});

test("verrouillage après 5 échecs, même pour une adresse inconnue", async () => {
  const email = "inconnu@exemple.com";
  for (let i = 0; i < 5; i += 1) {
    await db.query("INSERT INTO login_attempts (email, ip_address, succeeded) VALUES (?, '127.0.0.1', 0)", [email]);
  }
  const jar = new CookieJar();
  const locked = await submit(jar, "/connexion", "/connexion", { email, password: "Nimporte-quoi-42" });
  assert.equal(locked.status, 429);
  assert.match(locked.text, /Trop de tentatives/);
});

test("inscription d'un mandataire : profil public créé", async () => {
  const jar = new CookieJar();
  const res = await submit(jar, "/mandataire/inscription", "/mandataire/inscription", {
    pseudo: "Afiavi.H", email: "afiavi@exemple.com", password: STRONG, passwordConfirm: STRONG, terms: "on",
  });
  assert.equal(res.status, 303);
  const [[row]] = await db.query(
    "SELECT u.role, u.status, mp.slug FROM users u JOIN mandataire_profiles mp ON mp.user_id = u.id WHERE u.email = ?",
    ["afiavi@exemple.com"],
  );
  assert.equal(row.role, "mandataire");
  assert.equal(row.status, "pending_email");
  assert.equal(row.slug, "afiavi-h");
});

test("adresse déjà utilisée par un compte client : aucun compte mandataire, e-mail explicatif", async () => {
  const jar = new CookieJar();
  const res = await submit(jar, "/mandataire/inscription", "/mandataire/inscription", {
    pseudo: "Awa.Pro", email: "awa@exemple.com", password: STRONG, passwordConfirm: STRONG, terms: "on",
  });
  assert.equal(res.status, 303);
  assert.equal(res.location, "/verification-email", "même réponse qu'une inscription normale (aucun indice)");
  const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM users WHERE email = ?", ["awa@exemple.com"]);
  assert.equal(Number(n), 1, "aucun second compte");
  let mail = null;
  for (let i = 0; i < 60 && !mail; i += 1) {
    for (const file of (await fs.readdir(outbox)).filter((f) => f.endsWith(".json"))) {
      const m = JSON.parse(await fs.readFile(path.join(outbox, file), "utf8"));
      if (m.to === "awa@exemple.com" && /inscription comme mandataire/.test(m.text)) { mail = m; break; }
    }
    if (!mail) await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(mail, "e-mail explicatif envoyé au titulaire de l'adresse");
  assert.match(mail.subject, /déjà un compte/);
  assert.match(mail.text, /autre adresse/);
  assert.match(mail.text, /\/mandataire\/inscription/);
  // Adresse Gmail : l'alias « +pro » (même boîte de réception) est proposé
  const { contents } = await import("../services/mailService.js");
  const gmail = contents.exists({ pseudo: "Jo", email: "jo.d@gmail.com", role: "client" }, "mandataire");
  assert.match(gmail.notice.text, /jo\.d\+pro@gmail\.com/);
});
