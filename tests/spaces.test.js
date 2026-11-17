/**
 * Pages réelles des espaces client et mandataire (accueil, fiche, profil, paramètres, statistiques, aperçu),
 * sur une base MySQL TEMPORAIRE créée puis supprimée par le test. Usage : npm test
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDb = `mandix_spaces_${process.pid}`;
const storage = await fs.mkdtemp(path.join(os.tmpdir(), "mandix-spaces-"));
process.env.DB_NAME = testDb;
process.env.MAIL_OUTBOX_DIR = path.join(storage, "mails");
process.env.UPLOAD_PRIVATE_DIR = path.join(storage, "private");
process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";

let server, base, db;
const PASSWORD = "Baobab-Lagune-2026";

class CookieJar {
  constructor() { this.cookies = new Map(); }
  store(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || attrs.some((a) => /^max-age=0$/i.test(a.trim()) || (/^expires=/i.test(a.trim()) && new Date(a.trim().slice(8)) < new Date()))) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
}
async function http(jar, method, pathname, form, headers = {}) {
  const h = { cookie: jar.header(), ...headers };
  let body;
  if (form) { h["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
  const started = Date.now();
  const res = await fetch(base + pathname, { method, headers: h, body, redirect: "manual" });
  jar.store(res);
  const text = await res.text();
  if (process.env.TEST_TRACE) console.error(`[trace] ${method} ${pathname} → ${res.status} (${Date.now() - started} ms)`);
  return { status: res.status, location: res.headers.get("location"), text };
}
const csrfOf = (html) => html.match(/name="csrf-token" content="([^"]+)"/)?.[1];
async function login(email, password = PASSWORD) {
  const jar = new CookieJar();
  const page = await http(jar, "GET", "/connexion");
  const res = await http(jar, "POST", "/connexion", { _csrf: csrfOf(page.text), email, password });
  assert.equal(res.status, 303, `connexion ${email}`);
  return jar;
}
async function post(jar, pagePath, action, fields) {
  const page = await http(jar, "GET", pagePath);
  return http(jar, "POST", action, { _csrf: csrfOf(page.text), ...fields });
}

before(async () => {
  if (process.env.TEST_TRACE) console.error("[trace] préparation de la base");
  execFileSync(process.execPath, [path.join(root, "scripts", "db-setup.js")], { env: process.env, stdio: "ignore" });
  const mysql = (await import("mysql2/promise")).default;
  const config = (await import("../config/app.js")).default;
  db = await mysql.createConnection({ ...config.db, database: testDb, timezone: "Z" });
  const { hashPassword } = await import("../utils/password.js");
  const { MandataireAccount, accountTypeIds } = await import("../models/MandataireAccount.js");
  const hash = await hashPassword(PASSWORD);
  await db.execute("INSERT INTO users (public_id, role, email, pseudo, password_hash, status, email_verified_at) VALUES (UUID(), 'client', 'kofi@exemple.com', 'KofiTest', ?, 'active', UTC_TIMESTAMP())", [hash]);
  const [m] = await db.execute("INSERT INTO users (public_id, role, email, pseudo, password_hash, status, email_verified_at) VALUES (UUID(), 'mandataire', 'afi@exemple.com', 'AfiPro', ?, 'active', UTC_TIMESTAMP())", [hash]);
  const [p] = await db.execute("INSERT INTO mandataire_profiles (user_id, slug) VALUES (?, 'afipro')", [m.insertId]);
  const types = await accountTypeIds();
  await MandataireAccount.create({ mandataireId: p.insertId, typeId: types.get("wise").id, country: "BE", currency: "EUR", receive: { rib: "BE68 5390 0754 7034" } });
  const app = (await import("../app.js")).default;
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  server?.close();
  const pool = (await import("../config/database.js")).default;
  await pool.end().catch(() => {});
  if (db) {
    await db.query(`DROP DATABASE IF EXISTS \`${testDb}\``);
    await db.end();
  }
  await fs.rm(storage, { recursive: true, force: true });
});

test("espace client : accueil, fiche, profil, panneaux", async () => {
  const jar = await login("kofi@exemple.com");
  const home = await http(jar, "GET", "/client/dashboard");
  assert.equal(home.status, 200);
  assert.match(home.text, /AfiPro/, "mandataire réel listé");
  assert.doesNotMatch(home.text, /Moussa Diop|Afiavi/, "aucun profil fictif");
  const sheet = await http(jar, "GET", "/client/mandataires/afipro");
  assert.equal(sheet.status, 200);
  assert.doesNotMatch(sheet.text, /BE68 5390/, "coordonnées jamais sur la fiche");
  assert.equal((await http(jar, "GET", "/client/mandataires/inconnu")).status, 404);
  const panel = await http(jar, "GET", "/client/panneau/mandataires/afipro", null, { "X-Mandix-Panel": "1" });
  assert.equal(panel.status, 200);

  assert.equal((await post(jar, "/client/profil", "/client/profil", { pseudo: "x" })).status, 303);
  assert.match((await http(jar, "GET", "/client/profil")).text, /3 à 20 caractères/);
  assert.equal((await post(jar, "/client/profil", "/client/profil", { pseudo: "AfiPro" })).status, 303);
  assert.match((await http(jar, "GET", "/client/profil")).text, /déjà pris/);
  await post(jar, "/client/profil", "/client/profil", { pseudo: "Kofi.B" });
  const [[u]] = await db.query("SELECT pseudo FROM users WHERE email = 'kofi@exemple.com'");
  assert.equal(u.pseudo, "Kofi.B");
});

test("paramètres : changement de mot de passe (autres sessions fermées)", async () => {
  const jar = await login("kofi@exemple.com");
  const other = await login("kofi@exemple.com");
  const bad = await post(jar, "/client/parametres", "/client/parametres/mot-de-passe", { current: "faux-mot-de-passe-1", password: "Pirogue#Marche-77z", passwordConfirm: "Pirogue#Marche-77z" });
  assert.equal(bad.status, 303);
  assert.match((await http(jar, "GET", "/client/parametres")).text, /actuel incorrect/);
  await post(jar, "/client/parametres", "/client/parametres/mot-de-passe", { current: PASSWORD, password: "Pirogue#Marche-77z", passwordConfirm: "Pirogue#Marche-77z" });
  assert.equal((await http(jar, "GET", "/client/parametres")).status, 200, "session courante conservée");
  // L'autre appareil est déconnecté immédiatement : chaque requête revérifie la session en base.
  assert.equal((await http(other, "GET", "/client/parametres")).status, 302);
  const [[s]] = await db.query("SELECT COUNT(*) AS n FROM auth_sessions WHERE revoked_reason = 'logout_all'");
  assert.ok(s.n >= 1, "les autres sessions du compte sont révoquées");
  await login("kofi@exemple.com", "Pirogue#Marche-77z");
});

test("espace mandataire : statistiques, profil, aperçu de la fiche", async () => {
  const jar = await login("afi@exemple.com");
  const stats = await http(jar, "GET", "/mandataire/statistiques");
  assert.equal(stats.status, 200);
  const bad = stats.text.match(/.{0,80}(NaN|undefined).{0,40}/);
  assert.equal(bad, null, `valeur invalide : ${bad?.[0]}`);
  await post(jar, "/mandataire/profil", "/mandataire/profil", { bio: "Transactions Wise et PayPal, réponse rapide.", country: "BJ", languages: "Français, Fon, <script>" });
  const [[p]] = await db.query("SELECT bio, country_code, languages FROM mandataire_profiles WHERE slug = 'afipro'");
  assert.equal(p.country_code, "BJ");
  assert.deepEqual(typeof p.languages === "string" ? JSON.parse(p.languages) : p.languages, ["Français", "Fon"], "langue invalide écartée");
  const preview = await http(jar, "GET", "/mandataire/apercu");
  assert.equal(preview.status, 200);
  assert.match(preview.text, /réponse rapide/);
  const clientSpace = await http(jar, "GET", "/client/dashboard");
  assert.equal(clientSpace.status, 302, "espace client : il faut une session client");
  assert.match(clientSpace.location, /^\/connexion\?suite=/);
});

test("suppression du compte : données personnelles anonymisées", async () => {
  const jar = await login("kofi@exemple.com", "Pirogue#Marche-77z");
  const res = await post(jar, "/client/parametres", "/client/compte/supprimer", {});
  assert.equal(res.status, 303);
  const [[u]] = await db.query("SELECT email, pseudo, status, deleted_at FROM users WHERE pseudo LIKE 'supprime-%'");
  assert.match(u.email, /@compte-supprime\.invalid$/);
  assert.equal(u.status, "deactivated");
  assert.ok(u.deleted_at);
  const page = await http(new CookieJar(), "GET", "/connexion");
  const again = await http(new CookieJar(), "POST", "/connexion", { _csrf: csrfOf(page.text), email: "kofi@exemple.com", password: "Pirogue#Marche-77z" });
  assert.notEqual(again.status, 303, "connexion impossible après suppression");
});

test("espace administrateur : indicateurs, listes, suspension et réactivation", async () => {
  const { hashPassword } = await import("../utils/password.js");
  const [a] = await db.execute(
    "INSERT INTO users (public_id, role, email, first_name, last_name, password_hash, status, email_verified_at) VALUES (UUID(), 'admin', 'admin@exemple.com', 'Rachida', 'Adjovi', ?, 'active', UTC_TIMESTAMP())",
    [await hashPassword(PASSWORD)],
  );
  await db.execute("INSERT INTO admin_profiles (user_id, admin_role) VALUES (?, 'super_admin')", [a.insertId]);
  const jar = await login("admin@exemple.com");
  for (const page of ["/admin/dashboard", "/admin/mandataires", "/admin/mandataires/afipro", "/admin/clients?tri=volume", "/admin/clients?q=supprime", "/admin/verifications"]) {
    const res = await http(jar, "GET", page);
    assert.equal(res.status, 200, page);
    const bad = res.text.match(/.{0,60}(NaN|undefined).{0,30}/);
    assert.equal(bad, null, `${page} : valeur invalide ${bad?.[0]}`);
  }
  assert.doesNotMatch((await http(jar, "GET", "/admin/mandataires/afipro")).text, /BE68 5390/, "coordonnées jamais montrées à l'administration");

  // Suspension du mandataire : session fermée, fiche retirée de la recherche publique ; puis réactivation.
  const pro = await login("afi@exemple.com");
  const [[u]] = await db.query("SELECT public_id FROM users WHERE email = 'afi@exemple.com'");
  const res = await post(jar, "/admin/mandataires/afipro", `/admin/comptes/${u.public_id}/suspendre`, { retour: "/admin/mandataires/afipro" });
  assert.equal(res.status, 303);
  assert.equal(res.location, "/admin/mandataires/afipro");
  assert.equal((await http(pro, "GET", "/mandataire/comptes")).status, 302, "mandataire suspendu déconnecté");
  assert.doesNotMatch((await http(new CookieJar(), "GET", "/mandataires")).text, /AfiPro/, "fiche retirée de la recherche");
  await post(jar, "/admin/mandataires/afipro", `/admin/comptes/${u.public_id}/reactiver`, { retour: "/admin/mandataires/afipro" });
  assert.match((await http(new CookieJar(), "GET", "/mandataires")).text, /AfiPro/, "fiche de nouveau visible");
  // Un administrateur ne peut pas être suspendu ; retour vers un site externe refusé.
  const [[me]] = await db.query("SELECT public_id FROM users WHERE email = 'admin@exemple.com'");
  const self = await post(jar, "/admin/clients", `/admin/comptes/${me.public_id}/suspendre`, { retour: "https://pirate.example" });
  assert.equal(self.location, "/admin/dashboard");
  const [[still]] = await db.query("SELECT status FROM users WHERE email = 'admin@exemple.com'");
  assert.equal(still.status, "active");
  // Les autres rôles n'ont pas accès à l'administration : sans session administrateur, retour à la connexion.
  const denied = await http(await login("afi@exemple.com"), "GET", "/admin/dashboard");
  assert.equal(denied.status, 302);
  assert.match(denied.location, /^\/connexion\?espace=admin&suite=/);
});

test("« Devenir prestataire » : espace mandataire si connecté en mandataire, sinon connexion", async () => {
  const { hashPassword } = await import("../utils/password.js");
  await db.execute(
    "INSERT INTO users (public_id, role, email, pseudo, password_hash, status, email_verified_at) VALUES (UUID(), 'client', 'momo@exemple.com', 'momo', ?, 'active', UTC_TIMESTAMP())",
    [await hashPassword(PASSWORD)],
  );
  // Visiteur : connexion à l'espace mandataire, avec le lien d'inscription professionnelle
  const guest = new CookieJar();
  assert.match((await http(guest, "GET", "/")).text, /href="\/espace-mandataire"/);
  const guestEnter = await http(guest, "GET", "/espace-mandataire");
  assert.equal(guestEnter.status, 302);
  assert.equal(guestEnter.location, "/connexion?espace=mandataire");
  const guestPage = await http(guest, "GET", guestEnter.location);
  assert.equal(guestPage.status, 200);
  assert.match(guestPage.text, /Votre espace/);
  assert.match(guestPage.text, /Pas encore de compte mandataire/);
  assert.doesNotMatch(guestPage.text, /Vous êtes connecté/);

  // Client connecté : le bouton est visible et mène à la connexion mandataire, pas à l'espace client
  const client = await login("momo@exemple.com");
  const home = await http(client, "GET", "/");
  assert.match(home.text, /Devenir prestataire/);
  assert.match(home.text, /Mon espace/);
  const enter = await http(client, "GET", "/espace-mandataire");
  assert.equal(enter.location, "/connexion?espace=mandataire");
  const proLogin = await http(client, "GET", enter.location);
  assert.equal(proLogin.status, 200, "plus de renvoi vers l'espace client");
  assert.doesNotMatch(proLogin.text, /Vous êtes connecté/, "aucun message superflu");
  assert.match(proLogin.text, /name="espace" value="mandataire"/);
  assert.equal((await http(client, "GET", "/connexion")).location, "/client/dashboard", "connexion ordinaire : réservée aux visiteurs");
  const wrong = await http(client, "POST", "/connexion", { _csrf: csrfOf(proLogin.text), email: "afi@exemple.com", password: "mauvais-mot-de-passe", espace: "mandataire" });
  assert.equal(wrong.status, 401);
  assert.equal((await http(client, "GET", "/client/dashboard")).status, 200, "échec : la session client reste ouverte");
  // Inscription mandataire depuis la session client : formulaire direct, la session client reste ouverte
  const signup = await http(client, "GET", "/mandataire/inscription");
  assert.equal(signup.status, 200, "plus de renvoi vers l'espace client");
  assert.doesNotMatch(signup.text, /Vous êtes connecté/, "aucun message superflu");
  assert.match(signup.text, /name="passwordConfirm"/, "formulaire d'inscription affiché directement");
  const created = await http(client, "POST", "/mandataire/inscription", {
    _csrf: csrfOf(signup.text), pseudo: "momo.pro", email: "momo.pro@exemple.com", password: PASSWORD, passwordConfirm: PASSWORD, terms: "on",
  });
  assert.equal(created.status, 303);
  assert.equal(created.location, "/verification-email");
  assert.equal((await http(client, "GET", "/client/dashboard")).status, 200, "session client conservée après la création du compte mandataire");
  const [[proUser]] = await db.execute("SELECT role FROM users WHERE email = 'momo.pro@exemple.com'");
  assert.equal(proUser.role, "mandataire");
  // Déconnexion : toujours vers la connexion, quel que soit le paramètre envoyé
  const again = await login("momo@exemple.com");
  const page = await http(again, "GET", "/");
  const evil = await http(again, "POST", "/deconnexion", { _csrf: csrfOf(page.text), suite: "https://pirate.example" });
  assert.equal(evil.location, "/connexion");
  // Même navigateur, deux onglets : connecté en client ET en mandataire, chaque espace avec sa session
  const both = await login("momo@exemple.com");
  const form = await http(both, "GET", "/connexion?espace=mandataire");
  assert.equal(form.status, 200, "connexion mandataire proposée malgré la session client");
  assert.match(form.text, /data-role-tab="client" data-role-tab-nav/, "onglet Client : mène à l'espace client déjà connecté");
  const proLoggedIn = await http(both, "POST", "/connexion", { _csrf: csrfOf(form.text), email: "afi@exemple.com", password: PASSWORD, espace: "mandataire" });
  assert.equal(proLoggedIn.status, 303);
  assert.equal(proLoggedIn.location, "/mandataire/comptes");
  const proTab = await http(both, "GET", "/mandataire/comptes");
  const clientTab = await http(both, "GET", "/client/dashboard");
  assert.equal(proTab.status, 200);
  assert.equal(clientTab.status, 200, "la session client reste ouverte");
  assert.match(proTab.text, /<meta name="mandix-space" content="mandataire">/);
  assert.match(clientTab.text, /<meta name="mandix-space" content="client">/);
  // Le jeton CSRF est partagé : un formulaire de l'onglet client reste valable après un passage dans l'onglet mandataire
  const clientForm = await http(both, "GET", "/client/profil");
  await http(both, "GET", "/mandataire/profil");
  const saved = await http(both, "POST", "/client/profil", { _csrf: csrfOf(clientForm.text), pseudo: "momo" });
  assert.notEqual(saved.status, 403, "jeton CSRF toujours valable");
  // Appels JavaScript : l'en-tête X-Mandix-Space choisit la session
  const asClientApi = await http(both, "GET", "/api/session", null, { accept: "application/json", "x-mandix-space": "client" });
  const asProApi = await http(both, "GET", "/api/session", null, { accept: "application/json", "x-mandix-space": "mandataire" });
  assert.match(asClientApi.text, /"role":"client"/);
  assert.match(asProApi.text, /"role":"mandataire"/);
  // Déconnexion de l'onglet mandataire : l'onglet client reste connecté
  const out = await http(both, "POST", "/deconnexion", { _csrf: csrfOf(proTab.text), espace: "mandataire" });
  assert.equal(out.location, "/connexion?espace=mandataire");
  assert.equal((await http(both, "GET", "/mandataire/comptes")).status, 302);
  assert.equal((await http(both, "GET", "/client/dashboard")).status, 200, "session client intacte");

  // Mandataire connecté : « Devenir prestataire » et l'inscription mènent à son espace
  const pro = await login("afi@exemple.com");
  assert.doesNotMatch((await http(pro, "GET", "/")).text, /Devenir prestataire/);
  const proEnter = await http(pro, "GET", "/espace-mandataire");
  assert.equal(proEnter.status, 302);
  assert.equal(proEnter.location, "/mandataire/comptes");
  assert.equal((await http(pro, "GET", "/connexion?espace=mandataire")).location, "/mandataire/comptes");
  const proSignup = await http(pro, "GET", "/mandataire/inscription");
  assert.equal(proSignup.status, 302);
  assert.equal(proSignup.location, "/mandataire/comptes");
});

test("connexion : chaque onglet n'accepte que son type de compte", async () => {
  const jar = new CookieJar();
  const page = await http(jar, "GET", "/connexion");
  assert.match(page.text, /name="espace" value="client"/, "onglet Client par défaut");
  // Compte mandataire depuis l'onglet Client : refusé, aucune session ouverte
  const asClient = await http(jar, "POST", "/connexion", { _csrf: csrfOf(page.text), email: "afi@exemple.com", password: PASSWORD, espace: "client" });
  assert.equal(asClient.status, 403);
  assert.match(asClient.text, /compte mandataire/);
  assert.equal((await http(jar, "GET", "/mandataire/comptes")).status, 302, "aucune session ouverte");
  // Compte client depuis l'onglet Professionnel : refusé
  const proPage = await http(jar, "GET", "/connexion?espace=mandataire");
  assert.match(proPage.text, /name="espace" value="mandataire"/);
  const asPro = await http(jar, "POST", "/connexion", { _csrf: csrfOf(proPage.text), email: "momo@exemple.com", password: PASSWORD, espace: "mandataire" });
  assert.equal(asPro.status, 403);
  assert.match(asPro.text, /compte client/);
  assert.equal((await http(jar, "GET", "/client/dashboard")).status, 302, "aucune session ouverte");
  // Bon onglet : connexion à son espace
  const ok = await http(jar, "POST", "/connexion", { _csrf: csrfOf(asPro.text), email: "afi@exemple.com", password: PASSWORD, espace: "mandataire" });
  assert.equal(ok.status, 303);
  assert.equal(ok.location, "/mandataire/comptes");
  const clientJar = new CookieJar();
  const clientPage = await http(clientJar, "GET", "/connexion");
  const clientOk = await http(clientJar, "POST", "/connexion", { _csrf: csrfOf(clientPage.text), email: "momo@exemple.com", password: PASSWORD, espace: "client" });
  assert.equal(clientOk.location, "/client/dashboard");
  // Page de l'espace mandataire demandée sans session : onglet Professionnel présélectionné
  const guest = new CookieJar();
  const redirected = await http(guest, "GET", "/mandataire/statistiques");
  assert.match(redirected.location, /^\/connexion\?espace=mandataire&suite=/);
  assert.match((await http(guest, "GET", redirected.location)).text, /name="espace" value="mandataire"/);
});

test("connexion administrateur : jamais redirigée vers une autre session du navigateur", async () => {
  // Navigateur déjà connecté en client ET en mandataire
  const jar = await login("momo@exemple.com");
  const proForm = await http(jar, "GET", "/connexion?espace=mandataire");
  await http(jar, "POST", "/connexion", { _csrf: csrfOf(proForm.text), email: "afi@exemple.com", password: PASSWORD, espace: "mandataire" });
  assert.equal((await http(jar, "GET", "/mandataire/comptes")).status, 200);

  // Administration demandée : connexion administrateur, pas l'espace client ou mandataire
  const toLogin = await http(jar, "GET", "/admin/verifications");
  assert.equal(toLogin.status, 302);
  assert.equal(toLogin.location, "/connexion?espace=admin&suite=%2Fadmin%2Fverifications");
  const page = await http(jar, "GET", toLogin.location);
  assert.equal(page.status, 200, "formulaire affiché malgré les sessions client et mandataire");
  assert.match(page.text, /Espace <span class="auth-hl">administrateur<\/span>/);
  assert.match(page.text, /name="espace" value="admin"/);
  assert.doesNotMatch(page.text, /role="tablist"/, "pas d'onglets Client / Professionnel");
  assert.doesNotMatch(page.text, /href="\/inscription"/, "pas d'inscription");
  // Sans « espace » : la page à rouvrir suffit à choisir la connexion administrateur
  const bySuite = await http(jar, "GET", "/connexion?suite=%2Fadmin%2Fdashboard");
  assert.equal(bySuite.status, 200);
  assert.match(bySuite.text, /name="espace" value="admin"/);

  // Comptes client et mandataire refusés, aucune session administrateur ouverte
  for (const email of ["momo@exemple.com", "afi@exemple.com"]) {
    const refused = await http(jar, "POST", "/connexion", { _csrf: csrfOf(page.text), email, password: PASSWORD, espace: "admin", suite: "/admin/verifications" });
    assert.equal(refused.status, 403);
    assert.match(refused.text, /pas un compte administrateur/);
  }
  assert.equal((await http(jar, "GET", "/admin/dashboard")).status, 302);
  // Un administrateur n'entre pas par l'onglet Client
  const other = new CookieJar();
  const viaClient = await http(other, "GET", "/connexion");
  const adminAsClient = await http(other, "POST", "/connexion", { _csrf: csrfOf(viaClient.text), email: "admin@exemple.com", password: PASSWORD, espace: "client" });
  assert.equal(adminAsClient.status, 403);
  assert.match(adminAsClient.text, /compte administrateur/);

  // Administrateur : session de l'espace administrateur, retour à la page demandée
  const ok = await http(jar, "POST", "/connexion", { _csrf: csrfOf(page.text), email: "admin@exemple.com", password: PASSWORD, espace: "admin", suite: "/admin/verifications" });
  assert.equal(ok.status, 303);
  assert.equal(ok.location, "/admin/verifications");
  const admin = await http(jar, "GET", "/admin/dashboard");
  assert.equal(admin.status, 200);
  assert.match(admin.text, /<meta name="mandix-space" content="admin">/);
  const sessionAs = async (space) => (await http(jar, "GET", "/api/session", null, { accept: "application/json", "x-mandix-space": space })).text;
  assert.match(await sessionAs("admin"), /"role":"admin"/);
  // Les deux autres sessions restent ouvertes, chacune sur son compte
  assert.match(await sessionAs("client"), /"role":"client"/);
  assert.match(await sessionAs("mandataire"), /"role":"mandataire"/);
  assert.equal((await http(jar, "GET", "/connexion?espace=admin")).location, "/admin/dashboard", "déjà connecté : retour à l'administration");

  // Déconnexion de l'administration : retour à sa connexion, les autres sessions intactes
  const out = await http(jar, "POST", "/deconnexion", { _csrf: csrfOf(admin.text), espace: "admin" });
  assert.equal(out.location, "/connexion?espace=admin");
  assert.equal((await http(jar, "GET", "/admin/dashboard")).status, 302);
  assert.equal((await http(jar, "GET", "/client/dashboard")).status, 200);
  assert.equal((await http(jar, "GET", "/mandataire/comptes")).status, 200);
});

test("suggestions : envoyées depuis les espaces client et mandataire, visibles uniquement par l'équipe", async () => {
  const client = await login("momo@exemple.com");
  const form = await http(client, "GET", "/client/suggestions");
  assert.equal(form.status, 200);
  assert.match(form.text, /Envoyer ma suggestion/);
  assert.match(form.text, /href="\/client\/suggestions"/, "lien dans le menu");
  // Données vérifiées par le serveur
  const invalid = await http(client, "POST", "/client/suggestions", { _csrf: csrfOf(form.text), topic: "pirate", message: "court" });
  assert.equal(invalid.status, 422);
  assert.match(invalid.text, /Choisissez un sujet/);
  assert.match(invalid.text, /10 caractères minimum/);
  const sent = await http(client, "POST", "/client/suggestions", { _csrf: csrfOf(form.text), topic: "feature", message: "Pouvoir <b>filtrer</b> les mandataires par délai de réponse." });
  assert.equal(sent.status, 303);
  assert.equal(sent.location, "/client/suggestions");
  const after = await http(client, "GET", "/client/suggestions");
  assert.match(after.text, /Suggestion envoyée/);
  assert.doesNotMatch(after.text, /filtrer/, "la page ne liste pas les suggestions");

  const pro = await login("afi@exemple.com");
  const proForm = await http(pro, "GET", "/mandataire/suggestions");
  assert.equal(proForm.status, 200);
  assert.equal((await http(pro, "POST", "/mandataire/suggestions", { _csrf: csrfOf(proForm.text), topic: "problem", message: "Ajouter un rappel quand un client attend ma réponse." })).status, 303);

  // Réservées à l'équipe
  assert.equal((await http(client, "GET", "/admin/suggestions")).status, 302);
  const admin = await login("admin@exemple.com");
  const list = await http(admin, "GET", "/admin/suggestions");
  assert.equal(list.status, 200);
  assert.match(list.text, /Pouvoir &lt;b&gt;filtrer&lt;\/b&gt; les mandataires/, "texte affiché échappé");
  assert.match(list.text, /Ajouter un rappel/);
  assert.match(list.text, /data-live-badge="suggestions" aria-label="2 nouvelles"/);
  // Suivi : traitée
  const [[row]] = await db.query("SELECT id FROM suggestions WHERE topic = 'feature' ORDER BY id DESC LIMIT 1");
  const done = await http(admin, "POST", `/admin/suggestions/${row.id}/statut`, { _csrf: csrfOf(list.text), statut: "done" });
  assert.equal(done.status, 303);
  const [[updated]] = await db.query("SELECT status, read_at IS NOT NULL AS is_read FROM suggestions WHERE id = ?", [row.id]);
  assert.equal(updated.status, "done");
  assert.equal(Number(updated.is_read), 1);
  assert.match((await http(admin, "GET", "/admin/suggestions?statut=new")).text, /aria-label="1 nouvelle"/);
});

test("espace mandataire : fenêtre « Comprendre les niveaux », ouverte d'elle-même une seule fois", async () => {
  const pro = await login("afi@exemple.com");
  const page = await http(pro, "GET", "/mandataire/comptes");
  assert.match(page.text, /<dialog[^>]*id="levels-dialog"[^>]*data-auto-open/, "ouverte à la première visite");
  assert.match(page.text, /Pourquoi un plafond/);
  assert.match(page.text, /Montez plus vite avec vos clients actuels/);
  assert.match(page.text, /data-modal-open="levels-dialog"/, "bouton pour la rouvrir");
  const seen = await http(pro, "POST", "/mandataire/niveaux/vu", null, { "x-csrf-token": csrfOf(page.text), accept: "application/json" });
  assert.equal(seen.status, 200);
  const again = await http(pro, "GET", "/mandataire/statistiques");
  assert.match(again.text, /id="levels-dialog"/, "toujours disponible");
  assert.doesNotMatch(again.text, /data-auto-open/, "ne s'ouvre plus d'elle-même");
  assert.doesNotMatch((await http(await login("momo@exemple.com"), "GET", "/client/dashboard")).text, /levels-dialog/, "réservée aux mandataires");
});
