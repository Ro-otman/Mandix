/**
 * Tests de bout en bout de la messagerie temps réel (socket.io), des notifications et des comptes, sur une base
 * MySQL TEMPORAIRE créée puis supprimée par le test. Deux vraies connexions socket : un client et un mandataire.
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
const testDb = `mandix_msg_${process.pid}`;
const storage = await fs.mkdtemp(path.join(os.tmpdir(), "mandix-files-"));
process.env.DB_NAME = testDb;
process.env.MAIL_OUTBOX_DIR = path.join(storage, "mails");
process.env.UPLOAD_PRIVATE_DIR = path.join(storage, "private"); // fichiers de test isolés du stockage réel
process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";

let server, base, db, io, ioClient, config;
const sockets = [];

/* ------------------------------------------------------------------ Outils */

class CookieJar {
  constructor() { this.cookies = new Map(); }
  store(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || attrs.some((a) => a.trim().toLowerCase() === "max-age=0" || (a.trim().toLowerCase().startsWith("expires=") && new Date(a.trim().slice(8)) < new Date()))) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
}
async function http(jar, method, pathname, { form, json, multipart, headers = {} } = {}) {
  const h = { cookie: jar.header(), ...headers };
  let body;
  if (form) { h["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
  if (json) { h["content-type"] = "application/json"; body = JSON.stringify(json); }
  if (multipart) body = multipart;
  const res = await fetch(base + pathname, { method, headers: h, body, redirect: "manual" });
  jar.store(res);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* page HTML */ }
  return { status: res.status, location: res.headers.get("location"), text, data, headers: res.headers };
}
const csrfOf = (html) => html.match(/name="csrf-token" content="([^"]+)"/)?.[1] || html.match(/name="_csrf" value="([^"]+)"/)?.[1];

async function login(email, password) {
  const jar = new CookieJar();
  const page = await http(jar, "GET", "/connexion");
  const res = await http(jar, "POST", "/connexion", { form: { _csrf: csrfOf(page.text), email, password } });
  assert.equal(res.status, 303, `connexion de ${email}`);
  return jar;
}

function connect(jar, { origin = base, auth = {} } = {}) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(base, { transports: ["websocket"], extraHeaders: { cookie: jar.header(), origin }, auth, reconnection: false, forceNew: true });
    sockets.push(socket);
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (error) => reject(error));
  });
}
const request = (socket, name, payload) => new Promise((resolve) => socket.timeout(5000).emit(name, payload, (err, reply) => resolve(err ? { ok: false, error: "délai" } : reply)));
// 10 s : la base MySQL locale peut être lente (une écriture prend parfois plus d'une seconde).
const nextEvent = (socket, name, timeout = 10_000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`événement « ${name} » non reçu`)), timeout);
  socket.once(name, (payload) => { clearTimeout(timer); resolve(payload); });
});

// Plus petite image PNG valide (1 × 1 pixel)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
function pngForm(kind, csrf) {
  const form = new FormData();
  form.append("kind", kind);
  form.append("fichier", new Blob([PNG], { type: "image/png" }), "capture.png");
  return { multipart: form, headers: { "x-csrf-token": csrf } };
}

/* ------------------------------------------------------------------ Mise en place */

const PASSWORD = "Baobab-Lagune-2026";
let clientJar, proJar, otherJar, clientSocket, proSocket, conversationId, accountId, bareAccountId;

before(async () => {
  execFileSync(process.execPath, [path.join(root, "scripts", "db-setup.js")], { env: process.env, stdio: "ignore" });
  const mysql = (await import("mysql2/promise")).default;
  config = (await import("../config/app.js")).default;
  db = await mysql.createConnection({ ...config.db, database: testDb, timezone: "Z" });
  // Comptes actifs (inscription testée dans auth.test.js) : un client, un mandataire, un autre client.
  const { hashPassword } = await import("../utils/password.js");
  const hash = await hashPassword(PASSWORD);
  const users = [["client", "kofi@exemple.com", "KofiTest"], ["mandataire", "afi@exemple.com", "AfiPro"], ["client", "intrus@exemple.com", "Intrus"]];
  for (const [role, email, pseudo] of users) {
    const [r] = await db.execute(
      "INSERT INTO users (public_id, role, email, pseudo, password_hash, status, email_verified_at) VALUES (UUID(), ?, ?, ?, ?, 'active', UTC_TIMESTAMP())",
      [role, email, pseudo, hash],
    );
    if (role === "mandataire") await db.execute("INSERT INTO mandataire_profiles (user_id, slug) VALUES (?, 'afipro')", [r.insertId]);
  }
  const app = (await import("../app.js")).default;
  const { createRealtime } = await import("../realtime/io.js");
  ({ io: ioClient } = await import("socket.io-client"));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  io = createRealtime(server);
  clientJar = await login("kofi@exemple.com", PASSWORD);
  proJar = await login("afi@exemple.com", PASSWORD);
  otherJar = await login("intrus@exemple.com", PASSWORD);
});

after(async () => {
  sockets.forEach((s) => s.disconnect());
  io?.close();
  server?.close();
  const pool = (await import("../config/database.js")).default;
  await pool.end().catch(() => {});
  if (db) {
    await db.query(`DROP DATABASE IF EXISTS \`${testDb}\``);
    await db.end();
  }
  await fs.rm(storage, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ Comptes et marketplace */

test("le mandataire publie un compte (coordonnées chiffrées), visible dans la recherche", async () => {
  const page = await http(proJar, "GET", "/mandataire/comptes");
  assert.equal(page.status, 200);
  const csrf = csrfOf(page.text);

  const post = (json) => http(proJar, "POST", "/mandataire/comptes", { json: { type: "paypal", country: "FR", currency: "EUR", ...json }, headers: { "x-csrf-token": csrf } });
  // Cases à cocher : aucune n'est obligatoire (ici, seulement « Prix sur 100 ») ; numéro de carte refusé ; tarifs contrôlés.
  const bare = await post({ type: "wise", country: "BE", checks: { price: true }, price: { symbol: "EUR", amount: "65000", unit: "XOF" } });
  assert.equal(bare.status, 201, "compte sans E-mail ni RIB accepté");
  assert.equal(bare.data.account.receive, "");
  bareAccountId = bare.data.account.id;
  const card = await post({ checks: { rib: true }, rib: "4111 1111 1111 1111" });
  assert.equal(card.status, 422, "numéro de carte refusé");
  assert.match(card.data.errors.rib, /carte/);
  assert.ok((await post({ checks: { email: true, percent: true }, email: "afi.paiements@exemple.com", percent: "150" })).data.errors.percent);
  assert.ok((await post({ checks: { email: true, price: true }, email: "afi.paiements@exemple.com", price: { symbol: "EUR", amount: "", unit: "XOF" } })).data.errors.price);
  assert.ok((await post({ checks: { email: true, price: true }, email: "afi.paiements@exemple.com", price: { symbol: "€", amount: "100", unit: "XOF" } })).data.errors.price, "devise hors de la liste refusée");

  // PayPal : e-mail + prix sur 100 (100 € = 65 000 FCFA) + pourcentage.
  const res = await post({
    checks: { email: true, price: true, percent: true },
    email: "afi.paiements@exemple.com",
    price: { symbol: "EUR", amount: "65 000", unit: "XOF" },
    percent: "2,5 %", // saisi avec le signe : accepté
  });
  assert.equal(res.status, 201);
  accountId = res.data.account.id;
  assert.equal(res.data.account.receive, "afi.paiements@exemple.com");
  assert.equal(res.data.account.receiveEmail, "afi.paiements@exemple.com");
  assert.equal(res.data.account.rateLabel, "100 € = 65 000 FCFA");
  assert.equal(res.data.account.feeLabel, "2,5 %");

  const [[row]] = await db.query("SELECT receive_details_enc, rate_symbol, rate_amount, rate_unit, fee_percent FROM mandataire_accounts WHERE id = ?", [accountId]);
  assert.ok(!row.receive_details_enc.toString("latin1").includes("afi.paiements"), "coordonnées jamais en clair en base");
  assert.deepEqual([row.rate_symbol, Number(row.rate_amount), row.rate_unit, Number(row.fee_percent)], ["EUR", 65000, "XOF", 2.5]);

  // Virement : titulaire, RIB, BIC et adresse (cases à cocher), chiffrés ; envoyés au client une coordonnée par ligne.
  assert.match((await post({ type: "virement", checks: { bic: true }, bic: "ABC" })).data.errors.bic, /BIC/);
  assert.ok((await post({ type: "virement", checks: { holder: true }, holder: "1234" })).data.errors.holder, "titulaire : lettres uniquement");
  const wire = await post({
    type: "virement",
    checks: { holder: true, rib: true, bic: true, address: true },
    holder: "Afiavi Hounkpè", rib: "FR76 3000 6000 0112 3456 7890 189", bic: "bnpa frpp", address: "12 rue de la Paix, 75002 Paris",
  });
  assert.equal(wire.status, 201);
  assert.equal(wire.data.account.receive, "Titulaire : Afiavi Hounkpè\nRIB : FR76 3000 6000 0112 3456 7890 189\nBIC : BNPAFRPP\nAdresse : 12 rue de la Paix, 75002 Paris");
  assert.equal(wire.data.account.receiveBic, "BNPAFRPP");
  const [[wireRow]] = await db.query("SELECT receive_details_enc FROM mandataire_accounts WHERE id = ?", [wire.data.account.id]);
  assert.ok(!wireRow.receive_details_enc.toString("latin1").includes("Hounk"), "titulaire jamais en clair en base");

  const noCsrf = await http(proJar, "POST", "/mandataire/comptes", { json: { type: "wise", country: "BE", currency: "EUR", checks: { rib: true }, rib: "BE68 5390 0754 7034" } });
  assert.equal(noCsrf.status, 403, "jeton CSRF exigé");

  const list = await http(new CookieJar(), "GET", "/mandataires");
  assert.match(list.text, /AfiPro/);
  assert.doesNotMatch(list.text, /afi\.paiements/, "coordonnées absentes des pages publiques");
  // Carte : tarifs du compte phare seulement, chacun s'il existe. Compte phare = Wise (ajouté en premier) :
  // prix sur 100, sans pourcentage (même si le compte PayPal en a un).
  const priceRow = /<dt>Prix sur 100<\/dt><dd class="pro__rate"><strong>100 € = 65\s000 FCFA<\/strong><\/dd>/;
  assert.match(list.text, /<span class="pro__bank">Wise<\/span>/);
  assert.match(list.text, priceRow, "prix sur 100 du compte phare");
  assert.doesNotMatch(list.text, /<dt>Pourcentage<\/dt>/, "compte phare sans pourcentage : rien");
  // Recherche « PayPal » : le compte phare devient PayPal, qui a les deux : pourcentage et prix sur 100.
  const paypalSearch = await http(new CookieJar(), "GET", "/mandataires?type=paypal");
  assert.match(paypalSearch.text, /<span class="pro__bank">PayPal<\/span>/);
  assert.match(paypalSearch.text, /<dt>Pourcentage<\/dt><dd><strong>2,5 %<\/strong><\/dd>/);
  assert.match(paypalSearch.text, priceRow);
  // Profil public : tarifs affichés, coordonnées jamais.
  const profile = await http(new CookieJar(), "GET", "/mandataires/afipro");
  assert.equal(profile.status, 200);
  assert.match(profile.text, /100 € = 65 000 FCFA/);
  // Voir profil : « Pourcentage : 2,5 % » sous le compte PayPal uniquement (pas de chiffre global).
  assert.equal((profile.text.match(/Pourcentage : 2,5 %/g) || []).length, 1);
  assert.doesNotMatch(profile.text, /<dt>Pourcentage<\/dt>/, "pas de résumé global du pourcentage");
  assert.doesNotMatch(profile.text, /afi\.paiements|Hounkp|BNPAFRPP|rue de la Paix/, "coordonnées jamais sur le profil public");
});

/* ------------------------------------------------------------------ Connexions temps réel */

test("connexions temps réel : authentifiées, origine contrôlée", async () => {
  await assert.rejects(connect(new CookieJar()), /auth/, "sans jeton : refusé");
  await assert.rejects(connect(clientJar, { origin: "https://pirate.example" }), "autre site : refusé");
  const alone = await connect(clientJar); // sans espace précisé : la seule session du navigateur
  assert.ok(alone.connected);
  alone.disconnect();
  // Comme un même navigateur avec deux onglets : un seul jeu de cookies (session client + session mandataire),
  // chaque connexion indique l'espace de sa page. Tout le parcours guidé ci-dessous passe par ces deux connexions.
  const browser = new CookieJar();
  for (const jar of [clientJar, proJar]) {
    for (const [name, value] of jar.cookies) if (/^mandix\.(at|rt)\./.test(name)) browser.cookies.set(name, value);
  }
  assert.equal([...browser.cookies.keys()].filter((n) => n.startsWith("mandix.at.")).length, 2, "deux sessions dans le même navigateur");
  clientSocket = await connect(browser, { auth: { space: "client" } });
  proSocket = await connect(browser, { auth: { space: "mandataire" } });
  assert.ok(clientSocket.connected && proSocket.connected);
  await assert.rejects(connect(browser, { auth: { space: "admin" } }), /auth/, "espace sans session : refusé");
});

/* ------------------------------------------------------------------ Parcours complet */

test("parcours guidé complet, validé par le serveur, diffusé en direct", async () => {
  // 1. Demande du client : la conversation est créée ; le mandataire est notifié en direct.
  const proSecondTab = await connect(proJar, { auth: { space: "mandataire" } }); // 2ᵉ onglet du même mandataire
  const proNotified = nextEvent(proSocket, "notification:new");
  const proListUpdated = nextEvent(proSocket, "conversation:update");
  const proBadges = nextEvent(proSocket, "badges");
  const secondTabBadges = nextEvent(proSecondTab, "badges");
  const req1 = await request(clientSocket, "message:send", { mandataireSlug: "afipro", type: "request", data: { accountId } });
  assert.ok(req1.ok, req1.error);
  conversationId = req1.conversationId;
  assert.match((await proNotified).notification.title, /Nouvelle demande de KofiTest/);
  assert.equal((await proListUpdated).conversationId, conversationId);
  // Compteurs exacts en direct, dans tous les onglets du mandataire (sans recharger la page).
  const counts = await proBadges;
  assert.equal(counts.messages, 1, "1 message non lu");
  assert.equal(counts.notifications, 1, "1 notification non lue");
  assert.deepEqual(await secondTabBadges, counts, "2ᵉ onglet synchronisé");
  assert.equal((await request(proSocket, "badges:get", {})).messages, 1, "compteurs à la demande (reconnexion, onglet revenu)");
  // Lecture dans un onglet : l'autre onglet efface les non-lus de la conversation et reçoit les compteurs à jour.
  const readElsewhere = nextEvent(proSecondTab, "conversation:read");
  const afterRead = nextEvent(proSecondTab, "badges");
  assert.ok((await request(proSocket, "conversation:read", { conversationId })).ok);
  assert.equal((await readElsewhere).conversationId, conversationId);
  assert.equal((await afterRead).messages, 0);
  proSecondTab.disconnect();

  // Un autre client ne peut ni rejoindre ni écrire dans cette conversation.
  const intruder = await connect(otherJar);
  assert.equal((await request(intruder, "conversation:join", { conversationId })).ok, false);
  assert.equal((await request(intruder, "message:send", { conversationId, type: "amount", data: { amount: 10, currency: "EUR" } })).ok, false);

  // 2. Le mandataire rejoint et demande le montant ; le client le reçoit en direct.
  const joined = await request(proSocket, "conversation:join", { conversationId });
  assert.ok(joined.ok);
  assert.equal(joined.events.length, 1);
  const clientGets = nextEvent(clientSocket, "message:new");
  assert.ok((await request(proSocket, "message:send", { conversationId, type: "ask_amount" })).ok);
  assert.equal((await clientGets).event.type, "ask_amount");

  // Mauvais rôle, mauvaise étape : refusés.
  assert.match((await request(clientSocket, "message:send", { conversationId, type: "ask_amount" })).error, /pas à vous/);
  assert.equal((await request(proSocket, "message:send", { conversationId, type: "sent", data: {} })).ok, false);

  // 3. Montant : plafond du niveau 1 (200 €) contrôlé côté serveur.
  assert.match((await request(clientSocket, "message:send", { conversationId, type: "amount", data: { amount: 250, currency: "EUR" } })).error, /plafond/);
  const amount = await request(clientSocket, "message:send", { conversationId, type: "amount", data: { amount: 180, currency: "EUR" } });
  assert.ok(amount.ok);
  assert.equal(amount.event.data.eur, 180);

  // 4. Coordonnées : option PayPal obligatoire ; les coordonnées viennent de la base, pas du navigateur.
  assert.match((await request(proSocket, "message:send", { conversationId, type: "receive_info", data: {} })).error, /type d'envoi/i);
  const info = await request(proSocket, "message:send", { conversationId, type: "receive_info", data: { option: "friends_family", receive: "faux@pirate.example" } });
  assert.ok(info.ok);
  assert.equal(info.event.data.receive, "afi.paiements@exemple.com");
  assert.equal(info.event.data.optionLabel, "Amis et proches");

  // 5. Preuve de paiement : fichier vérifié, chiffré sur le disque, lisible par les seuls participants.
  const page = await http(clientJar, "GET", `/client/messages/afipro`);
  const csrf = csrfOf(page.text);
  const fake = new FormData();
  fake.append("kind", "payment_proof");
  fake.append("fichier", new Blob([Buffer.from("<script>alert(1)</script>")], { type: "image/png" }), "piege.png");
  assert.equal((await http(clientJar, "POST", `/api/conversations/${conversationId}/fichiers`, { multipart: fake, headers: { "x-csrf-token": csrf } })).status, 422, "faux PNG refusé");
  const up = await http(clientJar, "POST", `/api/conversations/${conversationId}/fichiers`, pngForm("payment_proof", csrf));
  assert.equal(up.status, 201, up.text);
  const [[file]] = await db.query("SELECT storage_key FROM attachments WHERE id = ?", [up.data.attachmentId]);
  const onDisk = await fs.readFile(path.join(config.uploads.privateDir, "attachments", `${file.storage_key}.bin`));
  assert.ok(!onDisk.subarray(0, 16).includes(Buffer.from("PNG")), "fichier chiffré sur le disque");
  const proof = await request(clientSocket, "message:send", { conversationId, type: "proof", data: { attachmentId: up.data.attachmentId } });
  assert.ok(proof.ok, proof.error);
  const asClient = await fetch(`${base}/fichiers/${up.data.attachmentId}`, { headers: { cookie: clientJar.header() } });
  assert.equal(asClient.status, 200);
  assert.deepEqual(Buffer.from(await asClient.arrayBuffer()), PNG);
  assert.equal((await fetch(`${base}/fichiers/${up.data.attachmentId}`, { headers: { cookie: otherJar.header() } })).status, 404, "autre client : refusé");

  // 6. Validation, compte de réception (numéro de carte refusé), envoi avec capture, réception, évaluation.
  assert.ok((await request(proSocket, "message:send", { conversationId, type: "proof_status", data: { status: "validated" } })).ok);
  assert.match((await request(clientSocket, "message:send", { conversationId, type: "payout_info", data: { accountType: "wise", receive: "4111111111111111" } })).error, /carte/);
  assert.ok((await request(clientSocket, "message:send", { conversationId, type: "payout_info", data: { accountType: "wise", receive: "kofi@exemple.com" } })).ok);
  const proPage = await http(proJar, "GET", `/mandataire/messages/${conversationId}`);
  const transfer = await http(proJar, "POST", `/api/conversations/${conversationId}/fichiers`, pngForm("transfer_proof", csrfOf(proPage.text)));
  assert.equal(transfer.status, 201);
  const sent = await request(proSocket, "message:send", { conversationId, type: "sent", data: { attachmentId: transfer.data.attachmentId } });
  assert.ok(sent.ok);
  assert.equal(sent.event.data.accountName, "Wise");
  assert.ok((await request(clientSocket, "message:send", { conversationId, type: "receipt", data: { received: true } })).ok);
  assert.equal((await request(clientSocket, "review:submit", { conversationId, rating: 5, appreciation: "decevant" })).ok, false, "appréciation incohérente refusée");
  assert.ok((await request(clientSocket, "review:submit", { conversationId, rating: 5, appreciation: "rapide_fiable" })).ok);

  const [[tx]] = await db.query("SELECT status, amount_eur FROM transactions WHERE conversation_id = (SELECT id FROM conversations WHERE public_id = ?)", [conversationId]);
  assert.equal(tx.status, "completed");
  const [[profile]] = await db.query("SELECT transactions_count, rating_avg, rating_count FROM mandataire_profiles WHERE slug = 'afipro'");
  assert.equal(profile.transactions_count, 1);
  assert.equal(Number(profile.rating_avg), 5);
  // L'évaluation n'est pas un message
  const [[reviewEvents]] = await db.query("SELECT COUNT(*) AS n FROM conversation_events WHERE event_type NOT IN ('request','ask_amount','amount','receive_info','proof','proof_status','payout_info','sent','receipt')");
  assert.equal(reviewEvents.n, 0);
});

test("messages chiffrés en base et notifications enregistrées", async () => {
  const [events] = await db.query("SELECT payload_enc FROM conversation_events");
  assert.ok(events.length >= 9);
  for (const e of events) {
    const raw = e.payload_enc.toString("latin1");
    assert.ok(!raw.includes("afi.paiements") && !raw.includes("kofi@exemple.com") && !raw.includes("180"), "contenu jamais en clair");
  }
  const page = await http(clientJar, "GET", "/client/notifications");
  assert.equal(page.status, 200);
  assert.match(page.text, /AfiPro a envoyé l(&#39;|')argent/);
  const csrf = csrfOf(page.text);
  const read = await http(clientJar, "POST", "/api/notifications/lu", { json: {}, headers: { "x-csrf-token": csrf } });
  assert.equal(read.data.unread, 0);
});

test("messagerie éphémère : effacement 3 jours après la clôture, transaction conservée", async () => {
  const { purgeExpiredMessages } = await import("../services/messagingService.js");
  // Transaction close depuis 1 jour : rien n'est effacé.
  assert.equal((await purgeExpiredMessages()).messages, 0);
  const [files] = await db.query("SELECT storage_key FROM attachments");
  await db.query("UPDATE transactions SET completed_at = UTC_TIMESTAMP() - INTERVAL 4 DAY");
  const purged = await purgeExpiredMessages();
  assert.ok(purged.messages >= 9);
  assert.equal(purged.files, 2);
  const [[left]] = await db.query("SELECT COUNT(*) AS n FROM conversation_events");
  assert.equal(left.n, 0);
  for (const f of files) {
    await assert.rejects(fs.access(path.join(config.uploads.privateDir, "attachments", `${f.storage_key}.bin`)), "fichier supprimé du disque");
  }
  const [[tx]] = await db.query("SELECT status, payout_details_enc FROM transactions");
  assert.equal(tx.status, "completed");
  assert.equal(tx.payout_details_enc, null, "coordonnées du client effacées");
});

test("paiement en attente : 7 jours, preuves de non-crédit, vérification par l'équipe Mandix", async () => {
  const { hashPassword } = await import("../utils/password.js");
  const [a] = await db.execute(
    "INSERT INTO users (public_id, role, email, first_name, last_name, password_hash, status, email_verified_at) VALUES (UUID(), 'admin', 'admin@exemple.com', 'Rachida', 'Adjovi', ?, 'active', UTC_TIMESTAMP())",
    [await hashPassword(PASSWORD)],
  );
  await db.execute("INSERT INTO admin_profiles (user_id, admin_role) VALUES (?, 'super_admin')", [a.insertId]);
  const send = (socket, type, data = {}) => request(socket, "message:send", { conversationId, type, data });

  // Nouvelle transaction jusqu'à la preuve, mise « En attente » par le mandataire.
  // Compte Wise ajouté sans coordonnées : le mandataire les saisit dans la messagerie (contrôlées par le serveur).
  assert.ok((await send(clientSocket, "request", { accountId: bareAccountId })).ok);
  assert.ok((await send(proSocket, "ask_amount")).ok);
  assert.ok((await send(clientSocket, "amount", { amount: 100, currency: "EUR" })).ok);
  assert.match((await send(proSocket, "receive_info", {})).error, /coordonnées/);
  assert.match((await send(proSocket, "receive_info", { receive: "4111 1111 1111 1111" })).error, /carte/);
  const typed = await send(proSocket, "receive_info", { receive: "afi.wise@exemple.com" });
  assert.ok(typed.ok, typed.error);
  assert.equal(typed.event.data.receive, "afi.wise@exemple.com");
  const page = await http(clientJar, "GET", "/client/messages/afipro");
  const proof = await http(clientJar, "POST", `/api/conversations/${conversationId}/fichiers`, pngForm("payment_proof", csrfOf(page.text)));
  assert.ok((await send(clientSocket, "proof", { attachmentId: proof.data.attachmentId })).ok);
  assert.ok((await send(proSocket, "proof_status", { status: "pending" })).ok);

  // Avant 7 jours : demande de preuve refusée ; après : acceptée.
  assert.match((await send(clientSocket, "credit_proof_request")).error, /7 jours/);
  await db.query("UPDATE transactions SET proof_pending_since = UTC_TIMESTAMP() - INTERVAL 8 DAY WHERE status = 'proof_pending'");
  assert.ok((await send(clientSocket, "credit_proof_request")).ok);

  const proPage = await http(proJar, "GET", `/mandataire/messages/${conversationId}`);
  const evidence = await http(proJar, "POST", `/api/conversations/${conversationId}/fichiers`, pngForm("credit_evidence", csrfOf(proPage.text)));
  assert.equal(evidence.status, 201);
  assert.ok((await send(proSocket, "credit_proof", { attachmentIds: [evidence.data.attachmentId] })).ok);
  assert.ok((await send(clientSocket, "verification_request")).ok);
  const [[vr]] = await db.query("SELECT reference, status FROM verification_requests ORDER BY id DESC LIMIT 1");
  assert.equal(vr.status, "open");

  // L'équipe consulte les preuves (fichier lisible par l'administration) et décide.
  const adminJar = await login("admin@exemple.com", PASSWORD);
  const queue = await http(adminJar, "GET", "/admin/verifications");
  assert.equal(queue.status, 200);
  assert.match(queue.text, new RegExp(vr.reference));
  assert.equal((await fetch(`${base}/fichiers/${evidence.data.attachmentId}`, { headers: { cookie: adminJar.header() } })).status, 200);
  const clientHears = nextEvent(clientSocket, "message:new");
  const decision = await http(adminJar, "POST", `/admin/verifications/${vr.reference}/decision`, { form: { _csrf: csrfOf(queue.text), decision: "authentic" } });
  assert.equal(decision.status, 303);
  const live = await clientHears;
  assert.equal(live.event.from, "system");
  assert.equal(live.event.type, "verification_result");
  assert.equal(live.event.data.authentic, true);
  const [[tx]] = await db.query("SELECT status, proof_pending_since > UTC_TIMESTAMP() - INTERVAL 1 MINUTE AS restarted FROM transactions ORDER BY id DESC LIMIT 1");
  assert.equal(tx.status, "proof_pending");
  assert.equal(Number(tx.restarted), 1, "le délai de 7 jours repart");
  // Décision unique
  const again = await http(adminJar, "POST", `/admin/verifications/${vr.reference}/decision`, { form: { _csrf: csrfOf(queue.text), decision: "not_authentic" } });
  assert.equal(again.status, 303);
  const [[closed]] = await db.query("SELECT status FROM verification_requests WHERE reference = ?", [vr.reference]);
  assert.equal(closed.status, "authentic");
});
