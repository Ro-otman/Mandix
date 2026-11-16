# Mandix

Plateforme de mise en relation entre clients et mandataires (partout dans le monde) pour des transactions d'un compte à l'autre (PayPal, Wise, virement, crypto…), suivies étape par étape dans une messagerie guidée.

> La plateforme ne détient, ne reçoit ni ne transfère aucun fonds, et ne collecte aucun identifiant bancaire.

## Prérequis

- Node.js 20+
- MySQL 8.0.16+

## Installation

```bash
npm install
cp .env.example .env        # puis renseigner l'accès MySQL et les trois secrets (voir ci-dessous)
npm run db:setup            # crée la base, applique database/schema.sql et les seeds
npm run dev                 # http://localhost:3000
npm test                    # tests de bout en bout (base MySQL temporaire, créée puis supprimée)
npm run admin:create -- --email admin@exemple.com --prenom Awa --nom Dossou   # premier administrateur
```

## Authentification

Connexion par **jeton d'accès** (JWT HS256, 15 min) et **jeton de rafraîchissement** (opaque, 256 bits, haché en base,
renouvelé à chaque usage), tous deux en cookies `HttpOnly`, `SameSite=Lax`, `Secure` et préfixés `__Host-` en production.

**Une session par espace** : cookies `mandix.at.<espace>` / `mandix.rt.<espace>` (client, mandataire, admin). Un même
navigateur peut être connecté en client dans un onglet et en mandataire dans un autre. Chaque requête utilise la
session de son espace : chemin `/client…`, `/mandataire…`, `/admin…`, sinon en-tête `X-Mandix-Space` (appels JavaScript,
lu dans `<meta name="mandix-space">`), paramètre ou champ `espace` (connexion, déconnexion, fichiers), et `auth.space`
pour socket.io. Les pages publiques utilisent le dernier espace visité. La déconnexion ne ferme que l'espace concerné.

| Étape | Route | Détails |
|---|---|---|
| Inscription | `POST /inscription`, `POST /mandataire/inscription` | Pseudo unique, Argon2id, robustesse du mot de passe (zxcvbn ≥ 3/4). Adresse déjà utilisée : même réponse, le titulaire est prévenu par e-mail. |
| Confirmation de l'e-mail | `GET /verification-email/:jeton` | Lien à usage unique, 24 h. Renvoi : `POST /verification-email/renvoyer` (1 par minute, 5 par jour). |
| Connexion | `POST /connexion` | « Rester connecté » = 30 jours, sinon 12 h. 5 échecs en 15 min sur une adresse = blocage 15 min. |
| Devenir prestataire | `GET /espace-mandataire` | Mandataire connecté : son espace. Sinon : `/connexion?espace=mandataire` ; un client connecté peut y ouvrir son compte mandataire, ou en créer un via `/mandataire/inscription` (sa session client reste ouverte). Aucune pièce justificative n'est demandée aux mandataires. |
| Rafraîchissement | automatique | Jeton d'accès expiré : rotation du jeton de rafraîchissement à la requête suivante. Jeton déjà renouvelé présenté de nouveau (après 30 s) = vol présumé, session révoquée. |
| Mot de passe oublié | `POST /mot-de-passe-oublie` | Même réponse qu'un compte existe ou non ; lien de 30 min. |
| Réinitialisation | `POST /reinitialisation/:jeton` | Toutes les sessions du compte sont fermées ; e-mail de confirmation. |
| Déconnexion | `POST /deconnexion`, `POST /deconnexion/partout` | Session révoquée immédiatement (un jeton d'accès copié ne sert plus). |

- **Secrets** (`.env`, jamais dans le code) : `JWT_ACCESS_SECRET`, `COOKIE_SECRET`, `CSRF_SECRET`, trois valeurs différentes
  d'au moins 32 caractères : `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
- **CSRF** : jeton signé (double submit, `csrf-csrf`) lié au navigateur (cookie `HttpOnly`, `__Host-` en production),
  pas à la session : les onglets client et mandataire d'un même navigateur partagent le même jeton.
- **E-mails** : sans SMTP en développement, ils sont enregistrés dans `storage/mail-outbox` et consultables sur
  [/dev/emails](http://localhost:3000/dev/emails). En production, SMTP est obligatoire.
- **Espaces** : `/client`, `/mandataire`, `/admin` réservés à leur rôle (sans session pour cet espace : connexion).
- **Base existante** : appliquer dans l'ordre les migrations de `database/migrations/` (008 : jetons de connexion ;
  009 : messagerie chiffrée et éphémère ; 010 : statut « demande envoyée » ; 011 : statistiques durables ;
  012 : tarifs des comptes).

## Messagerie temps réel et notifications

- **socket.io** sur le même serveur HTTP (`realtime/io.js`) : authentifié par le cookie du jeton d'accès, origine contrôlée,
  session revérifiée à chaque action, 40 actions par minute au plus. Client servi localement (`/vendor/socket.io`).
- **Messagerie guidée validée par le serveur** (`services/messagingService.js`) : chaque message préfait est vérifié
  (rôle, étape de la transaction, plafond en euros, option PayPal / virement, pièce jointe de la bonne transaction).
  L'étape en cours est `transactions.status` ; les messages en sont la trace.
- **Chiffrement** (AES-256-GCM, clé `DATA_ENCRYPTION_KEY` dans `.env`, à sauvegarder) : contenu des messages,
  coordonnées de réception (mandataires et clients), fichiers joints sur le disque.
- **Messages éphémères** : effacés avec leurs fichiers **3 jours après la clôture de leur transaction** (une transaction
  en cours garde ses messages : délai de 7 jours, vérification par l'équipe). Les transactions restent (plafonds,
  statistiques, évaluations), sans coordonnées. Ménage horaire automatique.
- **Fichiers** : type vérifié d'après le contenu (PNG, JPEG, WebP, PDF, 5 Mo), lus via `/fichiers/:id` par les seuls
  participants (et l'administration pour les vérifications).
- **Notifications** : enregistrées (fil « Notifications ») et poussées en direct (toast, compteurs du menu).
  Notifications lues supprimées après 30 jours.

## Espaces (données réelles)

| Espace | Pages |
|---|---|
| Client | Accueil (recherche), fiche d'un mandataire, Messages, Notifications, profil (pseudo), paramètres (mot de passe, suppression du compte) |
| Mandataire | Mes comptes (coordonnées chiffrées), Statistiques, Messages, Notifications, profil public, aperçu de la fiche |
| Administration | Vue d'ensemble, mandataires (fiche, suspension / réactivation), clients (tri, recherche, suspension), vérifications (décision publiée dans la conversation) |

**Ajout d'un compte** (mandataire) : cases à cocher **E-mail** et/ou **RIB** (où recevoir l'argent, au moins l'une,
chiffrées en base), **Prix sur 100** (symbole et unité libres : « 100 € = 65 000 FCFA ») et **Pourcentage** sur la
transaction. Les tarifs sont publics : ils s'affichent sous chaque compte du profil (`utils/accountRates.js`).

**Niveaux** (`utils/limits.js`) : plafond par transaction selon le nombre de transactions menées à terme —
niveau 1 : 200 € (dès l'inscription), 2 : 300 € (30), 3 : 500 € (50), 4 : 700 € (70), 5 : 1 000 € (100),
6 : 2 000 € (200), 7 : 3 000 € (300), 8 : 5 000 € (500), 9 : 7 000 € (700), 10 : sans plafond, « +10 000 € »,
et certification (1 000).

Les profils fictifs de la recherche ne s'affichent que si `DEMO_MARKETPLACE=true` (revue du design, hors production).

## Production et performance

```bash
npm run build               # minifie CSS et JS (webpack), noms avec empreinte, copies .br et .gz
NODE_ENV=production npm start
# ou, en une commande : npm run prod
```

- **Développement** (`npm run dev`) : fichiers sources de `public/css` et `public/js`, servis tels quels.
- **Production** : fichiers construits de `public/dist` (manifeste `public/dist/manifest.json`, lu par `utils/assets.js`).
  Pour tester les fichiers construits en local : `npm run build` puis `ASSETS=dist npm run dev`.
- Relancer `npm run build` après chaque modification d'une feuille de style ou d'un script, avant le déploiement.
- Cache navigateur : fichiers construits 1 an (`immutable`, le nom change à chaque modification), polices 1 an,
  images 30 jours, GSAP 30 jours ; les pages HTML ne sont pas mises en cache.
- Compression : fichiers construits pré-compressés (Brotli niveau 11, gzip niveau 9) ; pages HTML compressées à la volée.
- Polices hébergées sur le site (`public/fonts`, licence SIL OFL) : aucune requête vers un service tiers.

## Structure

| Dossier | Rôle |
|---|---|
| `config/` | Variables d'environnement, pool MySQL, mailer |
| `routes/` | Déclaration des routes, montées dans `routes/index.js` |
| `controllers/` | Lecture de la requête, appel des services, rendu de la vue |
| `services/` | Règles métier (authentification, jetons, e-mails, messagerie…) |
| `models/` | Accès aux données (requêtes SQL préparées) |
| `validators/` | Schémas de validation serveur (express-validator) |
| `middlewares/` | Authentification par jetons, rôles, CSRF, messages flash, limitation, erreurs |
| `views/` | Gabarits EJS par espace : `public`, `auth`, `client`, `mandataire`, `admin` |
| `public/` | CSS, JS et images statiques |
| `storage/private/` | Documents téléversés — **jamais** servis en statique |
| `database/` | `schema.sql`, `migrations/`, `seeds/`, `mandix.sql` (installation complète, générée par `npm run db:bundle`) |
| `tests/` | Tests de bout en bout (`npm test`) |
