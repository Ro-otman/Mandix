-- =============================================================================
-- Mandix — script complet d'installation de la base de données
-- Fichier GÉNÉRÉ par scripts/build-sql-bundle.js : ne pas modifier à la main.
-- Sources : database/schema.sql (qui crée la base `mandix`) + database/seeds/*.sql
-- =============================================================================

-- =============================================================================
-- Mandix — Schéma MySQL (version 2 : comptes de paiement et messagerie guidée)
-- Requis : MySQL 8.0.16+ (CHECK appliqués, JSON, colonnes générées), InnoDB, utf8mb4.
-- Dates : DATETIME en UTC (le pool est configuré avec timezone 'Z').
--
-- Ce que la base reflète :
--   * Clients et mandataires : un pseudo et un e-mail à l'inscription (ni nom, ni téléphone, ni adresse).
--   * Mandataires : présentation, langues, pays FACULTATIF ; leurs comptes (PayPal, Wise, Virement…)
--     sont publiés dès leur ajout. Le pays d'un compte est libre (un mandataire sénégalais peut avoir
--     un compte en France ou en Belgique).
--   * Messagerie guidée : aucune saisie libre (sauf le montant, saisi en chiffres). Chaque message est un
--     événement préfait (demande, montant, coordonnées + option d'envoi, preuve, décision Validé / Rejeté /
--     En attente, délai de 7 jours et preuves de non-crédit, vérification Mandix, compte de réception, envoi +
--     capture, réception confirmée). L'évaluation, obligatoire, est enregistrée à part (reviews).
--   * Transactions : plafond et certification découlent du nombre de transactions terminées
--     (7 niveaux dans utils/limits.js, certification à 1 000). L'évaluation du client est obligatoire
--     et clôt la transaction.
--   * Montants : celui que le client saisit dans la messagerie, en DECIMAL dans la devise choisie ; l'euro est la
--     devise de référence (contrôle du plafond). Mandix ne détient, ne reçoit ni ne transfère aucun fonds.
--   * Coordonnées de réception (IBAN, e-mail PayPal, adresse de portefeuille…) : chiffrées par
--     l'application (AES-256-GCM, clé dans .env), jamais stockées en clair. Jamais de mot de passe,
--     de code secret, de numéro de carte ni de phrase de récupération (refusés à la saisie).
--   * Fichiers (preuves, captures, logos ajoutés avec « Autre ») : storage/private, jamais servis en statique.
--
-- Supprimé par rapport à la version 1 : villes, zones et expériences, établissements partenaires,
-- justificatifs, qualifications, services et offres, disponibilités, demandes, rendez-vous, revenus
-- déclarés, réclamations, alertes de sécurité, profils clients séparés.
-- Base créée avec la version 1 : voir database/migrations/002_v2_comptes_messagerie.sql.
--
-- Politique de suppression :
--   * users / profils : jamais supprimés physiquement -> deleted_at + anonymisation.
--   * historiques (conversations, transactions, avis, audit) : ON DELETE RESTRICT.
--   * comptes d'un mandataire : retrait logique (status 'removed'), les transactions passées y renvoient.
--   * audit_logs : table en ajout seul. conversation_events : messages chiffrés, non modifiables, effacés
--     3 jours après la clôture de leur transaction (messagerie éphémère).
-- =============================================================================

-- Création de la base. Hébergement mutualisé (base imposée, pas de droit CREATE DATABASE) :
-- supprimez ces deux lignes et sélectionnez votre base avant l'import.
CREATE DATABASE IF NOT EXISTS `mandix` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `mandix`;

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- 1. Comptes utilisateurs et profils
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id           CHAR(36)        NOT NULL COMMENT 'UUID exposé dans les URL (évite l''énumération des id)',
  role                ENUM('client','mandataire','admin') NOT NULL,
  email               VARCHAR(191)    NOT NULL,
  password_hash       VARCHAR(255)    NOT NULL COMMENT 'Argon2id',
  pseudo              VARCHAR(40)     NULL COMMENT 'Clients et mandataires : nom affiché, choisi à l''inscription',
  first_name          VARCHAR(80)     NULL COMMENT 'Administrateurs',
  last_name           VARCHAR(80)     NULL COMMENT 'Administrateurs',
  status              ENUM('pending_email','active','suspended','deactivated') NOT NULL DEFAULT 'pending_email',
  suspension_reason   VARCHAR(500)    NULL,
  email_verified_at   DATETIME        NULL,
  terms_accepted_at   DATETIME        NULL,
  privacy_accepted_at DATETIME        NULL,
  last_login_at       DATETIME        NULL,
  last_seen_at        DATETIME        NULL COMMENT 'Disponibilité en temps réel : « En ligne », « En ligne il y a X min »',
  failed_login_count  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until        DATETIME        NULL,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Sert aussi à « Membre depuis … »',
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at          DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_public_id (public_id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_pseudo (pseudo),
  KEY idx_users_role_status (role, status),
  CONSTRAINT chk_users_identity CHECK (
    (role IN ('client','mandataire') AND pseudo IS NOT NULL)
    OR (role = 'admin' AND first_name IS NOT NULL AND last_name IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Administration : vue d'ensemble, mandataires et clients (suspension / réactivation).
CREATE TABLE IF NOT EXISTS admin_profiles (
  user_id     BIGINT UNSIGNED NOT NULL,
  admin_role  ENUM('super_admin','moderateur') NOT NULL DEFAULT 'moderateur',
  granted_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_admin_profiles_user    FOREIGN KEY (user_id)    REFERENCES users (id),
  CONSTRAINT fk_admin_profiles_granter FOREIGN KEY (granted_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Jetons à usage unique (vérification e-mail, réinitialisation du mot de passe). Seul le hash est stocké.
CREATE TABLE IF NOT EXISTS user_tokens (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  purpose     ENUM('email_verification','password_reset') NOT NULL,
  token_hash  CHAR(64) NOT NULL COMMENT 'SHA-256 du jeton envoyé',
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_tokens_hash (token_hash),
  KEY idx_user_tokens_user (user_id, purpose),
  CONSTRAINT fk_user_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Profil public du mandataire. Le plafond par transaction n'est pas stocké : il est calculé à partir de
-- transactions_count (utils/limits.js) : niveau 1 dès l'inscription 300 € · niveau 2 à 70 transactions 700 € ·
-- niveau 3 à 100 : 1 000 € · niveau 4 à 200 : 3 000 € · niveau 5 à 300 : 7 000 € · niveau 6 à 700 : 10 000 € ·
-- niveau 7 à 1 000 : plus de 10 000 € (sans plafond) et certification.
CREATE TABLE IF NOT EXISTS mandataire_profiles (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id             BIGINT UNSIGNED NOT NULL,
  slug                VARCHAR(140)    NOT NULL,
  country_code        CHAR(2)         NULL COMMENT 'Pays du mandataire (ISO 3166-1), facultatif, sans lien avec le pays de ses comptes',
  bio                 TEXT            NULL COMMENT 'Présentation',
  languages           JSON            NULL COMMENT 'Langues parlées, ex. ["Français","Fon","Anglais"]',
  avatar_key          VARCHAR(100)    NULL,
  -- Badge bleu « vérifié » : affiché uniquement si un contrôle a réellement été fait (verified_at renseigné).
  verified_at         DATETIME        NULL,
  verified_by         BIGINT UNSIGNED NULL,
  -- Agrégats dénormalisés, mis à jour à chaque transaction terminée (évaluée).
  transactions_count  INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Transactions terminées : plafond et certification',
  certified_at        DATETIME        NULL COMMENT 'Badge doré : 1 000 transactions terminées atteintes',
  rating_avg          DECIMAL(3,2)    NULL,
  rating_count        INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mandataire_profiles_user (user_id),
  UNIQUE KEY uq_mandataire_profiles_slug (slug),
  KEY idx_mandataire_profiles_activity (transactions_count),
  CONSTRAINT fk_mandataire_profiles_user     FOREIGN KEY (user_id)     REFERENCES users (id),
  CONSTRAINT fk_mandataire_profiles_verifier FOREIGN KEY (verified_by) REFERENCES users (id),
  CONSTRAINT chk_mandataire_rating CHECK (rating_avg IS NULL OR (rating_avg >= 1 AND rating_avg <= 5)),
  CONSTRAINT chk_mandataire_country CHECK (country_code IS NULL OR (country_code REGEXP '^[A-Za-z]{2}$' AND CAST(country_code AS BINARY) = CAST(UPPER(country_code) AS BINARY)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. Comptes de paiement des mandataires
-- -----------------------------------------------------------------------------

-- Catalogue des comptes de la plateforme (PayPal, Stripe, Wise, Virement…). Un mandataire peut en ajouter
-- un avec « Autre » (nom + logo) : il rejoint alors le catalogue (is_builtin = 0).
CREATE TABLE IF NOT EXISTS account_types (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug                 VARCHAR(60)  NOT NULL,
  name                 VARCHAR(80)  NOT NULL,
  logo_path            VARCHAR(255) NULL COMMENT 'Logos intégrés : /images/services/<slug>.svg',
  logo_storage_key     VARCHAR(100) NULL COMMENT 'Logo envoyé avec « Autre » (PNG, JPG ou WebP, 1 Mo maximum)',
  receive_label        VARCHAR(120) NOT NULL DEFAULT 'Coordonnées de réception' COMMENT 'Libellé du champ : IBAN, e-mail PayPal…',
  receive_placeholder  VARCHAR(160) NULL,
  is_builtin           TINYINT(1)   NOT NULL DEFAULT 0,
  created_by           BIGINT UNSIGNED NULL COMMENT 'Mandataire qui l''a ajouté avec « Autre »',
  sort_order           SMALLINT     NOT NULL DEFAULT 1000,
  is_active            TINYINT(1)   NOT NULL DEFAULT 1,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_account_types_slug (slug),
  UNIQUE KEY uq_account_types_name (name),
  KEY idx_account_types_catalog (is_active, sort_order),
  CONSTRAINT fk_account_types_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_account_types_logo CHECK (logo_path IS NOT NULL OR logo_storage_key IS NOT NULL OR is_builtin = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Compte d'un mandataire, publié sur sa fiche dès l'ajout (aucune validation préalable). Pour le modifier,
-- il le supprime puis l'ajoute de nouveau. Les coordonnées de réception ne sont visibles que du mandataire,
-- et du client à qui il les envoie dans la messagerie guidée.
CREATE TABLE IF NOT EXISTS mandataire_accounts (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  mandataire_id        BIGINT UNSIGNED NOT NULL,
  account_type_id      INT UNSIGNED    NOT NULL,
  country_code         CHAR(2)         NOT NULL COMMENT 'Pays où le compte est ouvert (obligatoire, libre, indépendant de la nationalité)',
  currency             CHAR(3)         NOT NULL COMMENT 'ISO 4217, proposée d''après le pays du compte',
  bank_name            VARCHAR(150)    NULL COMMENT 'Virement uniquement (facultatif)',
  rate_symbol          VARCHAR(8)      NULL COMMENT 'Prix sur 100 : devise des 100 (code ISO 4217, ex. EUR ; affichée « € »)',
  rate_amount          DECIMAL(15,2)   NULL COMMENT 'Prix sur 100 : montant versé pour 100 unités (ex. 65 000)',
  rate_unit            VARCHAR(12)     NULL COMMENT 'Prix sur 100 : devise du montant (code ISO 4217, ex. XOF ; affichée « FCFA »)',
  fee_percent          DECIMAL(5,2)    NULL COMMENT 'Pourcentage prélevé sur la transaction (ex. 25)',
  receive_details_enc  VARBINARY(1024) NOT NULL COMMENT 'Coordonnées de réception chiffrées (AES-256-GCM) : JSON {email, rib}, ou texte (anciens comptes)',
  status               ENUM('published','removed') NOT NULL DEFAULT 'published',
  published_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at           DATETIME NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mandataire_accounts_owner (mandataire_id, status),
  KEY idx_mandataire_accounts_search (account_type_id, country_code, status),
  KEY idx_mandataire_accounts_country (country_code, status),
  CONSTRAINT fk_mandataire_accounts_owner FOREIGN KEY (mandataire_id)   REFERENCES mandataire_profiles (id),
  CONSTRAINT fk_mandataire_accounts_type  FOREIGN KEY (account_type_id) REFERENCES account_types (id),
  CONSTRAINT chk_mandataire_accounts_country  CHECK ((country_code REGEXP '^[A-Za-z]{2}$' AND CAST(country_code AS BINARY) = CAST(UPPER(country_code) AS BINARY))),
  CONSTRAINT chk_mandataire_accounts_currency CHECK ((currency REGEXP '^[A-Za-z]{3}$' AND CAST(currency AS BINARY) = CAST(UPPER(currency) AS BINARY))),
  CONSTRAINT chk_mandataire_accounts_removed  CHECK (status <> 'removed' OR removed_at IS NOT NULL),
  CONSTRAINT chk_mandataire_accounts_rate CHECK (
    (rate_symbol IS NULL AND rate_amount IS NULL AND rate_unit IS NULL)
    OR (rate_symbol IS NOT NULL AND rate_amount > 0 AND rate_unit IS NOT NULL)
  ),
  CONSTRAINT chk_mandataire_accounts_fee CHECK (fee_percent IS NULL OR (fee_percent > 0 AND fee_percent <= 100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. Messagerie guidée et transactions
-- -----------------------------------------------------------------------------

-- Une conversation par couple client / mandataire.
CREATE TABLE IF NOT EXISTS conversations (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id           CHAR(36)        NOT NULL,
  client_id           BIGINT UNSIGNED NOT NULL,
  mandataire_id       BIGINT UNSIGNED NOT NULL,
  last_event_at       DATETIME(3)     NULL COMMENT 'Tri de la liste des conversations',
  client_read_at      DATETIME(3)     NULL COMMENT 'Messages non lus : événements postérieurs à cette date',
  mandataire_read_at  DATETIME(3)     NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_conversations_public_id (public_id),
  UNIQUE KEY uq_conversations_pair (client_id, mandataire_id),
  KEY idx_conversations_client (client_id, last_event_at),
  KEY idx_conversations_mandataire (mandataire_id, last_event_at),
  CONSTRAINT fk_conversations_client     FOREIGN KEY (client_id)     REFERENCES users (id),
  CONSTRAINT fk_conversations_mandataire FOREIGN KEY (mandataire_id) REFERENCES mandataire_profiles (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Transaction menée dans une conversation, de la demande à l'évaluation. Une seule transaction ouverte
-- par conversation (colonne générée open_lock + index unique).
--   awaiting_amount          : demande envoyée (« Je veux faire une transaction avec votre compte X »)
--   awaiting_receive_details : montant saisi par le client, contrôlé contre le plafond
--   awaiting_proof           : coordonnées de réception envoyées par le mandataire (PayPal : type d'envoi ;
--                              virement : instantané ou classique -> receive_option)
--   proof_review             : preuve de paiement reçue ; décision : Validé, Rejeté (nouvelle preuve) ou En attente
--   proof_pending            : En attente (paiement pas encore crédité), délai maximum de 7 jours (proof_pending_since)
--   credit_evidence_requested: délai dépassé, le client demande une preuve que l'argent n'est pas crédité
--   credit_evidence_sent     : le mandataire a envoyé ses captures ; le client confirme (retour à proof_pending,
--                              le délai repart) ou demande une vérification
--   under_verification       : l'équipe Mandix vérifie les preuves (verification_requests), puis notifie le client
--   disputed                 : preuves jugées non conformes, litige suivi par l'équipe
--   awaiting_payout_details  : paiement validé, le client indique son compte de réception (et son option -> payout_option)
--   awaiting_transfer        : le mandataire envoie l'argent puis la capture du transfert
--   awaiting_receipt         : le client confirme « reçu » ou « pas encore reçu » (nouvelle preuve du transfert)
--   awaiting_review          : argent reçu, évaluation du client OBLIGATOIRE (aucune nouvelle transaction avant)
--   completed                : évaluée — compte dans transactions_count
CREATE TABLE IF NOT EXISTS transactions (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reference               VARCHAR(20)     NOT NULL COMMENT 'Ex. TX-2026-000123',
  conversation_id         BIGINT UNSIGNED NOT NULL,
  client_id               BIGINT UNSIGNED NOT NULL,
  mandataire_id           BIGINT UNSIGNED NOT NULL,
  mandataire_account_id   BIGINT UNSIGNED NOT NULL COMMENT 'Compte du mandataire choisi par le client',
  receive_option          ENUM('friends_family','goods_services','instant','classic') NULL
                          COMMENT 'Option choisie par le mandataire : PayPal Amis et proches / Biens et services ; virement instantané / classique',
  status                  ENUM('requested','awaiting_amount','awaiting_receive_details','awaiting_proof','proof_review','proof_pending',
                               'credit_evidence_requested','credit_evidence_sent','under_verification','disputed',
                               'awaiting_payout_details','awaiting_transfer','awaiting_receipt','awaiting_review',
                               'completed','cancelled')
                          NOT NULL DEFAULT 'requested',
  currency                CHAR(3)         NULL COMMENT 'Devise du montant (par défaut celle du compte)',
  amount                  DECIMAL(14,2)   NULL COMMENT 'Montant saisi par le client dans la messagerie',
  amount_eur              DECIMAL(12,2)   NULL COMMENT 'Contre-valeur en euros, contrôlée contre le plafond',
  eur_rate                DECIMAL(18,8)   NULL COMMENT 'Taux indicatif utilisé pour la conversion',
  limit_eur               DECIMAL(12,2)   NULL COMMENT 'Plafond au moment de la demande (NULL : niveau 7, sans plafond)',
  payout_account_type_id  INT UNSIGNED    NULL COMMENT 'Compte sur lequel le client veut recevoir l''argent',
  payout_details_enc      VARBINARY(1024) NULL COMMENT 'Coordonnées de réception du client, chiffrées',
  payout_option           ENUM('friends_family','goods_services','instant','classic') NULL
                          COMMENT 'Option choisie par le client pour recevoir l''argent (PayPal, virement)',
  proof_pending_since     DATETIME NULL COMMENT 'Début du délai de 7 jours (En attente, ou relancé après confirmation)',
  first_response_at       DATETIME NULL COMMENT 'Première réponse du mandataire (demande du montant) : délai de réponse',
  proof_rejections        SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Preuves de paiement rejetées pendant la transaction',
  proof_validated_at      DATETIME NULL,
  transfer_sent_at        DATETIME NULL,
  receipt_confirmed_at    DATETIME NULL COMMENT 'Le client a confirmé avoir reçu l''argent',
  completed_at            DATETIME NULL,
  cancelled_at            DATETIME NULL,
  open_lock               BIGINT UNSIGNED AS (CASE WHEN status IN ('completed','cancelled') THEN NULL ELSE conversation_id END) STORED,
  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_transactions_reference (reference),
  UNIQUE KEY uq_transactions_open (open_lock),
  KEY idx_transactions_conversation (conversation_id, created_at),
  KEY idx_transactions_mandataire (mandataire_id, status, created_at),
  KEY idx_transactions_client (client_id, created_at),
  KEY idx_transactions_stats (status, completed_at),
  CONSTRAINT fk_transactions_conversation FOREIGN KEY (conversation_id)        REFERENCES conversations (id),
  CONSTRAINT fk_transactions_client       FOREIGN KEY (client_id)              REFERENCES users (id),
  CONSTRAINT fk_transactions_mandataire   FOREIGN KEY (mandataire_id)          REFERENCES mandataire_profiles (id),
  CONSTRAINT fk_transactions_account      FOREIGN KEY (mandataire_account_id)  REFERENCES mandataire_accounts (id),
  CONSTRAINT fk_transactions_payout_type  FOREIGN KEY (payout_account_type_id) REFERENCES account_types (id),
  CONSTRAINT chk_transactions_amount   CHECK (amount IS NULL OR amount > 0),
  CONSTRAINT chk_transactions_limit    CHECK (amount_eur IS NULL OR limit_eur IS NULL OR amount_eur <= limit_eur),
  CONSTRAINT chk_transactions_currency CHECK (currency IS NULL OR (currency REGEXP '^[A-Za-z]{3}$' AND CAST(currency AS BINARY) = CAST(UPPER(currency) AS BINARY))),
  CONSTRAINT chk_transactions_done     CHECK (status <> 'completed' OR completed_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Messages préfaits (aucun texte libre). payload : paramètres du message (compte, montant, statut, option
-- d'envoi, réception) ; les coordonnées de réception n'y figurent jamais en clair
-- (secure_payload_enc). Les fichiers joints (preuve, capture, preuves de non-crédit) sont dans attachments.
-- sender_role 'system' : message de l'équipe Mandix (résultat d'une vérification).
-- L'évaluation du client n'est PAS un message : elle va dans reviews, sans être envoyée au mandataire.
CREATE TABLE IF NOT EXISTS conversation_events (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id     BIGINT UNSIGNED NOT NULL,
  transaction_id      BIGINT UNSIGNED NULL,
  sender_role         ENUM('client','mandataire','system') NOT NULL,
  sender_user_id      BIGINT UNSIGNED NULL COMMENT 'NULL = système',
  event_type          ENUM('request','ask_amount','amount','receive_info','proof','proof_status',
                           'credit_proof_request','credit_proof','credit_proof_ok','verification_request',
                           'verification_result','payout_info','sent','receipt') NOT NULL,
  payload_enc         VARBINARY(4096) NOT NULL COMMENT 'Contenu du message chiffré (AES-256-GCM, contexte event:<conversation>), jamais en clair',
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_conversation_events_thread (conversation_id, created_at),
  KEY idx_conversation_events_transaction (transaction_id),
  CONSTRAINT fk_conversation_events_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id),
  CONSTRAINT fk_conversation_events_transaction  FOREIGN KEY (transaction_id)  REFERENCES transactions (id),
  CONSTRAINT fk_conversation_events_sender       FOREIGN KEY (sender_user_id)  REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fichiers joints aux messages : preuve de paiement (client), capture du transfert (mandataire), preuves que
-- l'argent n'est pas crédité (mandataire, jusqu'à 5 par message). Image (PNG, JPG, WebP) ou PDF, 5 Mo maximum.
-- Accessibles aux deux participants et, en cas de vérification, à l'équipe Mandix.
CREATE TABLE IF NOT EXISTS attachments (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id  BIGINT UNSIGNED NOT NULL,
  transaction_id   BIGINT UNSIGNED NOT NULL,
  event_id         BIGINT UNSIGNED NULL COMMENT 'Message auquel le fichier est joint',
  uploaded_by      BIGINT UNSIGNED NOT NULL,
  kind             ENUM('payment_proof','transfer_proof','credit_evidence') NOT NULL,
  storage_key      VARCHAR(100) NOT NULL COMMENT 'Nom aléatoire dans storage/private',
  original_name    VARCHAR(255) NOT NULL,
  mime_type        VARCHAR(100) NOT NULL,
  size_bytes       INT UNSIGNED NOT NULL,
  sha256           CHAR(64)     NOT NULL COMMENT 'Repère la réutilisation d''une même capture',
  decision         ENUM('pending','validated','rejected') NULL COMMENT 'Preuve de paiement : Validé, Rejeté ou En attente',
  decided_at       DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attachments_key (storage_key),
  KEY idx_attachments_transaction (transaction_id, kind),
  KEY idx_attachments_event (event_id),
  KEY idx_attachments_sha (sha256),
  CONSTRAINT fk_attachments_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id),
  CONSTRAINT fk_attachments_transaction  FOREIGN KEY (transaction_id)  REFERENCES transactions (id),
  CONSTRAINT fk_attachments_event        FOREIGN KEY (event_id)        REFERENCES conversation_events (id) ON DELETE SET NULL,
  CONSTRAINT fk_attachments_uploader     FOREIGN KEY (uploaded_by)     REFERENCES users (id),
  CONSTRAINT chk_attachments_type     CHECK (mime_type IN ('image/png','image/jpeg','image/webp','application/pdf')),
  CONSTRAINT chk_attachments_size     CHECK (size_bytes BETWEEN 1 AND 5242880),
  CONSTRAINT chk_attachments_decision CHECK (kind = 'payment_proof' OR decision IS NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Demande de vérification : le client conteste les preuves de non-crédit du mandataire. L'équipe Mandix
-- (espace admin, « Vérifications ») examine les captures et tranche ; le client reçoit une notification
-- (type verification.result) et un message « Équipe Mandix » dans la conversation.
CREATE TABLE IF NOT EXISTS verification_requests (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reference         VARCHAR(20)     NOT NULL COMMENT 'Ex. VR-2026-000012',
  transaction_id    BIGINT UNSIGNED NOT NULL,
  conversation_id   BIGINT UNSIGNED NOT NULL,
  client_id         BIGINT UNSIGNED NOT NULL,
  mandataire_id     BIGINT UNSIGNED NOT NULL,
  request_event_id  BIGINT UNSIGNED NULL COMMENT 'Message « demander une vérification » (NULL une fois le message effacé)',
  status            ENUM('open','authentic','not_authentic') NOT NULL DEFAULT 'open',
  decided_by        BIGINT UNSIGNED NULL,
  decided_at        DATETIME        NULL,
  decision_note     VARCHAR(1000)   NULL COMMENT 'Note interne de l''équipe',
  open_lock         BIGINT UNSIGNED AS (CASE WHEN status = 'open' THEN transaction_id ELSE NULL END) STORED,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_verification_requests_reference (reference),
  UNIQUE KEY uq_verification_requests_open (open_lock),
  KEY idx_verification_requests_queue (status, created_at),
  KEY idx_verification_requests_mandataire (mandataire_id),
  CONSTRAINT fk_verification_requests_transaction  FOREIGN KEY (transaction_id)   REFERENCES transactions (id),
  CONSTRAINT fk_verification_requests_conversation FOREIGN KEY (conversation_id)  REFERENCES conversations (id),
  CONSTRAINT fk_verification_requests_client       FOREIGN KEY (client_id)        REFERENCES users (id),
  CONSTRAINT fk_verification_requests_mandataire   FOREIGN KEY (mandataire_id)    REFERENCES mandataire_profiles (id),
  CONSTRAINT fk_verification_requests_event        FOREIGN KEY (request_event_id) REFERENCES conversation_events (id) ON DELETE SET NULL,
  CONSTRAINT fk_verification_requests_decider      FOREIGN KEY (decided_by)       REFERENCES users (id),
  CONSTRAINT chk_verification_requests_decision CHECK (status = 'open' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 4. Évaluations
-- -----------------------------------------------------------------------------

-- Une évaluation par transaction, obligatoire : elle fait passer la transaction à 'completed'.
-- Enregistrée par la plateforme uniquement (note moyenne du mandataire) : elle n'apparaît pas dans la conversation
-- et n'est pas envoyée au mandataire.
-- Note de 1 à 5 et appréciation préfaite (rapide_fiable, professionnel, recommande, correct, delai,
-- trop_lent, communication, decevant), sans texte libre.
CREATE TABLE IF NOT EXISTS reviews (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  transaction_id  BIGINT UNSIGNED NOT NULL,
  client_id       BIGINT UNSIGNED NOT NULL,
  mandataire_id   BIGINT UNSIGNED NOT NULL,
  rating          TINYINT UNSIGNED NOT NULL,
  appreciation    VARCHAR(40)     NOT NULL,
  status          ENUM('published','hidden') NOT NULL DEFAULT 'published',
  hidden_by       BIGINT UNSIGNED NULL,
  hidden_reason   VARCHAR(500)    NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reviews_transaction (transaction_id),
  KEY idx_reviews_mandataire (mandataire_id, status, created_at),
  KEY idx_reviews_client (client_id),
  CONSTRAINT fk_reviews_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id),
  CONSTRAINT fk_reviews_client      FOREIGN KEY (client_id)      REFERENCES users (id),
  CONSTRAINT fk_reviews_mandataire  FOREIGN KEY (mandataire_id)  REFERENCES mandataire_profiles (id),
  CONSTRAINT fk_reviews_hider       FOREIGN KEY (hidden_by)      REFERENCES users (id),
  CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT chk_reviews_hidden CHECK (status <> 'hidden' OR hidden_reason IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5. Notifications
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NOT NULL,
  type           VARCHAR(50)  NOT NULL COMMENT 'message.new, transaction.proof, transaction.sent, review.received, account.published, verification.result…',
  actor_user_id  BIGINT UNSIGNED NULL COMMENT 'Auteur de l''action (avatar dans le fil)',
  title          VARCHAR(200) NOT NULL,
  body           VARCHAR(1000) NULL,
  link_path      VARCHAR(255) NULL COMMENT 'Chemin interne uniquement (jamais d''URL externe)',
  cta_label      VARCHAR(60)  NULL COMMENT 'Libellé du bouton, ex. « Voir mes comptes »',
  read_at        DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_inbox (user_id, read_at, created_at),
  CONSTRAINT fk_notifications_user  FOREIGN KEY (user_id)       REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 6. Sécurité, traçabilité, sessions
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS login_attempts (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email        VARCHAR(191) NOT NULL,
  user_id      BIGINT UNSIGNED NULL,
  ip_address   VARCHAR(45)  NOT NULL,
  user_agent   VARCHAR(255) NULL,
  succeeded    TINYINT(1)   NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_login_attempts_email (email, created_at),
  KEY idx_login_attempts_ip (ip_address, created_at),
  CONSTRAINT fk_login_attempts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Traçabilité interne des actions sensibles (suspension, ajout / suppression de compte, décision sur
-- une preuve…). N'est plus affichée dans l'espace admin ; conservée côté serveur, en ajout seul.
-- Pas de clé étrangère : l'historique doit survivre à toute évolution.
CREATE TABLE IF NOT EXISTS audit_logs (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id  BIGINT UNSIGNED NULL,
  actor_role     VARCHAR(30)  NULL,
  action         VARCHAR(100) NOT NULL COMMENT 'admin.login, mandataire.suspend, account.create, proof.reject…',
  entity_type    VARCHAR(50)  NULL,
  entity_id      BIGINT UNSIGNED NULL,
  metadata       JSON         NULL COMMENT 'Avant/après, motif — jamais de mot de passe ni de coordonnées',
  ip_address     VARCHAR(45)  NULL,
  user_agent     VARCHAR(255) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_logs_actor (actor_user_id, created_at),
  KEY idx_audit_logs_entity (entity_type, entity_id),
  KEY idx_audit_logs_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sessions de connexion par jetons : une ligne par appareil / navigateur connecté.
-- Le jeton d'accès (JWT, 15 min) porte public_id ; chaque requête vérifie que la session n'est ni révoquée
-- ni expirée : déconnexion, réinitialisation du mot de passe ou suspension prennent effet immédiatement.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id       CHAR(36)        NOT NULL COMMENT 'Identifiant porté par le jeton d''accès (sid)',
  user_id         BIGINT UNSIGNED NOT NULL,
  remember        TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '« Rester connecté » : 30 jours, sinon 12 heures',
  user_agent      VARCHAR(255)    NULL,
  ip_address      VARCHAR(45)     NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      DATETIME        NOT NULL COMMENT 'Fin absolue : aucun renouvellement au-delà',
  revoked_at      DATETIME        NULL,
  revoked_reason  ENUM('logout','logout_all','password_reset','reuse_detected','account_suspended') NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_sessions_public_id (public_id),
  KEY idx_auth_sessions_user (user_id, revoked_at),
  KEY idx_auth_sessions_expires (expires_at),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Jetons de rafraîchissement : renouvelés à chaque usage (rotation). Seul le hash est stocké.
-- Un jeton déjà renouvelé présenté de nouveau (après 30 s de tolérance pour les requêtes simultanées)
-- signale un vol : toute la session est révoquée.
CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id   BIGINT UNSIGNED NOT NULL,
  token_hash   CHAR(64)        NOT NULL COMMENT 'SHA-256 du jeton envoyé dans le cookie',
  expires_at   DATETIME        NOT NULL,
  rotated_at   DATETIME        NULL COMMENT 'Renseigné quand le jeton a été remplacé par un nouveau',
  replaced_by  BIGINT UNSIGNED NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_refresh_tokens_hash (token_hash),
  KEY idx_auth_refresh_tokens_session (session_id),
  KEY idx_auth_refresh_tokens_expires (expires_at),
  CONSTRAINT fk_auth_refresh_tokens_session FOREIGN KEY (session_id) REFERENCES auth_sessions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 7. Vues publiques
-- Les pages publiques et la recherche lisent UNIQUEMENT ces vues : un mandataire suspendu, un compte
-- retiré ou une évaluation masquée n'y apparaissent jamais, et les coordonnées de réception
-- (colonnes *_enc) n'y figurent pas.
-- =============================================================================

-- Mandataires actifs ayant au moins un compte publié.
CREATE OR REPLACE VIEW v_public_mandataires AS
SELECT
  mp.id, mp.slug, u.pseudo, mp.country_code, mp.bio, mp.languages, mp.avatar_key,
  mp.rating_avg, mp.rating_count, mp.transactions_count,
  (mp.verified_at IS NOT NULL)  AS is_verified,
  (mp.certified_at IS NOT NULL) AS is_certified,
  u.last_seen_at, u.created_at AS member_since
FROM mandataire_profiles mp
JOIN users u ON u.id = mp.user_id
WHERE u.role = 'mandataire'
  AND u.status = 'active'
  AND u.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM mandataire_accounts ma WHERE ma.mandataire_id = mp.id AND ma.status = 'published');

-- Comptes publiés, sans les coordonnées de réception. Filtre « Compte » + « Pays » de la recherche.
CREATE OR REPLACE VIEW v_public_mandataire_accounts AS
SELECT
  ma.id, ma.mandataire_id, t.slug AS type_slug, t.name AS type_name, t.logo_path, t.logo_storage_key,
  ma.country_code, ma.currency, ma.bank_name, ma.rate_symbol, ma.rate_amount, ma.rate_unit, ma.fee_percent, ma.published_at
FROM mandataire_accounts ma
JOIN v_public_mandataires pm ON pm.id = ma.mandataire_id
JOIN account_types t         ON t.id = ma.account_type_id AND t.is_active = 1
WHERE ma.status = 'published';

-- Évaluations publiées ; l'auteur est affiché par son pseudo.
CREATE OR REPLACE VIEW v_public_reviews AS
SELECT r.id, r.mandataire_id, r.rating, r.appreciation, r.created_at, u.pseudo AS author_pseudo
FROM reviews r
JOIN users u ON u.id = r.client_id
JOIN v_public_mandataires pm ON pm.id = r.mandataire_id
WHERE r.status = 'published';

-- =============================================================================
-- 8. Déclencheurs
-- Corps à instruction unique : compatibles avec phpMyAdmin, le client mysql et mysql2
-- sans directive DELIMITER. Sur un serveur avec binlog actif, la création peut exiger
-- log_bin_trust_function_creators = 1 (fréquent en hébergement mutualisé).
-- =============================================================================

-- Journal de traçabilité inaltérable depuis l'application.
DROP TRIGGER IF EXISTS trg_audit_logs_no_update;
CREATE TRIGGER trg_audit_logs_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs : modification interdite (journal en ajout seul)';

DROP TRIGGER IF EXISTS trg_audit_logs_no_delete;
CREATE TRIGGER trg_audit_logs_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs : suppression interdite (journal en ajout seul)';

-- L'historique d'une conversation ne se réécrit pas.
DROP TRIGGER IF EXISTS trg_conversation_events_no_update;
CREATE TRIGGER trg_conversation_events_no_update BEFORE UPDATE ON conversation_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'conversation_events : modification interdite';

-- Messagerie éphémère : les messages sont effacés 3 jours après la clôture de leur transaction (tâche de
-- ménage de l'application) ; ils restent non modifiables.
DROP TRIGGER IF EXISTS trg_conversation_events_no_delete;


-- ----- Seed : 001_reference_data.sql -----

-- Données de référence (idempotent). Aucune donnée de démonstration n'est présentée comme réelle :
-- pas de faux mandataires, pas de fausses évaluations.

SET NAMES utf8mb4;

-- Catalogue des comptes de la plateforme, dans l'ordre d'affichage (content/account-types.js).
-- Logos : public/images/services/<slug>.svg. Mandix n'est affilié à aucun de ces services ; les marques
-- appartiennent à leurs propriétaires. Les comptes ajoutés par les mandataires (« Autre ») s'ajoutent à la suite.
INSERT INTO account_types (slug, name, logo_path, receive_label, receive_placeholder, is_builtin, sort_order) VALUES
  ('paypal', 'PayPal', '/images/services/paypal.svg', 'Adresse e-mail PayPal', 'vous@exemple.com', 1, 10),
  ('stripe', 'Stripe', '/images/services/stripe.svg', 'E-mail ou identifiant du compte Stripe', 'vous@exemple.com', 1, 20),
  ('wise', 'Wise', '/images/services/wise.svg', 'IBAN ou e-mail Wise', 'BE68 5390 0754 7034 ou vous@exemple.com', 1, 30),
  ('virement', 'Virement', '/images/services/virement.svg', 'IBAN', 'FR76 3000 6000 0112 3456 7890 189', 1, 40),
  ('transcash', 'Transcash', '/images/services/transcash.svg', 'Référence du compte Transcash', 'Référence indiquée dans votre espace Transcash', 1, 50),
  ('neosurf', 'Neosurf', '/images/services/neosurf.svg', 'Identifiant myNeosurf', 'Identifiant ou e-mail myNeosurf', 1, 60),
  ('paysafecard', 'Paysafecard', '/images/services/paysafecard.svg', 'Identifiant my paysafecard', 'Identifiant ou e-mail my paysafecard', 1, 70),
  ('wero', 'Wero', '/images/services/wero.svg', 'Téléphone ou e-mail Wero', '+33 6 12 34 56 78', 1, 80),
  ('pcs', 'PCS Mastercard', '/images/services/pcs.svg', 'IBAN de la carte PCS Mastercard', 'FR76 …', 1, 90),
  ('skrill', 'Skrill', '/images/services/skrill.svg', 'Adresse e-mail Skrill', 'vous@exemple.com', 1, 100),
  ('westernunion', 'Western Union', '/images/services/westernunion.svg', 'Nom complet et pays du bénéficiaire', 'Prénom Nom — Ville, Pays', 1, 110),
  ('moneygram', 'MoneyGram', '/images/services/moneygram.svg', 'Nom complet et pays du bénéficiaire', 'Prénom Nom — Ville, Pays', 1, 120),
  ('crypto', 'Crypto', '/images/services/crypto.svg', 'Adresse de portefeuille (publique) et réseau', 'Ex. bc1q… (réseau Bitcoin)', 1, 130)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), logo_path = VALUES(logo_path), receive_label = VALUES(receive_label),
  receive_placeholder = VALUES(receive_placeholder), is_builtin = 1, sort_order = VALUES(sort_order);
