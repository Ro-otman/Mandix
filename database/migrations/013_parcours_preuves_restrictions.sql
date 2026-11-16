-- =============================================================================
-- Migration 013 : nouveau parcours de la preuve de paiement, vérification du mandataire, restrictions,
-- moyens de réception par pays, transactions rejetées. Compatible MySQL 8 et MariaDB.
--
-- Décisions du mandataire sur la preuve : « Valide : C'est bon ✅ », « Rejeté : C'est pas bon ❌ »,
-- « En attente : Pas encore bon 🔄 » (7 jours au plus, rappel quotidien au mandataire).
-- Au-delà de 2 rejets, le client choisit : Attendre (7 jours), Je laisse, Faire vérifier ce mandataire.
-- Vérification : le mandataire est restreint (72 h au plus) et doit envoyer les preuves du refus ; l'équipe
-- Mandix lève la restriction, ou la prolonge de 100 jours. Restreint : pas de nouveau compte, niveau bloqué.
-- Les transactions validées ET rejetées sont évaluées par le client ; seules les validées font monter de niveau.
-- =============================================================================

ALTER TABLE transactions
  MODIFY status ENUM('requested','awaiting_amount','awaiting_receive_details','awaiting_proof','proof_review','proof_pending',
                     'credit_evidence_requested','credit_evidence_sent','under_verification','disputed',
                     'proof_validated','rejection_choice','client_waiting','verification_requested','verification_review',
                     'awaiting_payout_details','awaiting_transfer','awaiting_receipt','awaiting_review',
                     'completed','rejected','cancelled')
         NOT NULL DEFAULT 'requested',
  ADD COLUMN outcome ENUM('success','rejected') NULL
         COMMENT 'Issue connue au moment de l''évaluation : validée (argent reçu) ou rejetée' AFTER status,
  ADD COLUMN pending_reminded_at DATETIME NULL
         COMMENT 'Dernier rappel quotidien au mandataire pour un paiement en attente' AFTER proof_pending_since,
  ADD COLUMN client_choice_notified_at DATETIME NULL
         COMMENT 'Client prévenu que le délai de 7 jours est écoulé (Je laisse / Faire vérifier)' AFTER pending_reminded_at,
  ADD COLUMN payout_method VARCHAR(40) NULL
         COMMENT 'Moyen de réception choisi par le client (content/payout-methods.js)' AFTER payout_option,
  ADD COLUMN payout_country CHAR(2) NULL COMMENT 'Pays du moyen de réception' AFTER payout_method;

-- Une transaction rejetée est close, comme une transaction terminée ou annulée.
ALTER TABLE transactions
  MODIFY open_lock BIGINT UNSIGNED AS (CASE WHEN status IN ('completed','rejected','cancelled') THEN NULL ELSE conversation_id END) STORED;

-- Nouveaux messages : choix du client, preuves du refus, demande du moyen de réception.
ALTER TABLE conversation_events
  MODIFY event_type ENUM('request','ask_amount','amount','receive_info','proof','proof_status',
                         'credit_proof_request','credit_proof','credit_proof_ok','verification_request',
                         'client_choice','refusal_proof','ask_payout',
                         'verification_result','payout_info','sent','receipt') NOT NULL;

ALTER TABLE verification_requests
  ADD COLUMN evidence_due_at DATETIME NULL
      COMMENT 'Le mandataire doit envoyer les preuves du refus avant cette date (72 h)' AFTER request_event_id;

-- Décision automatique (aucune preuve du refus sous 72 h) : sans auteur (decided_by NULL).
ALTER TABLE verification_requests DROP CONSTRAINT chk_verification_requests_decision;
ALTER TABLE verification_requests
  ADD CONSTRAINT chk_verification_requests_decision CHECK (status = 'open' OR decided_at IS NOT NULL);

ALTER TABLE mandataire_profiles
  ADD COLUMN restricted_until DATETIME NULL
      COMMENT 'Restriction : plus d''ajout de compte, niveau bloqué (vérification : 72 h au plus ; sanction : 100 jours)',
  ADD COLUMN restriction_reason ENUM('verification','sanction') NULL,
  ADD COLUMN restricted_level_count INT UNSIGNED NULL
      COMMENT 'Transactions réussies au début de la restriction : le niveau ne dépasse pas ce palier',
  ADD COLUMN rejected_count INT UNSIGNED NOT NULL DEFAULT 0
      COMMENT 'Transactions rejetées (évaluées par le client) : statistiques du profil';

CREATE OR REPLACE VIEW v_public_mandataires AS
SELECT
  mp.id, mp.slug, u.pseudo, mp.country_code, mp.bio, mp.languages, mp.avatar_key,
  mp.rating_avg, mp.rating_count, mp.transactions_count, mp.rejected_count,
  CASE WHEN mp.restricted_until > UTC_TIMESTAMP()
       THEN LEAST(mp.transactions_count, COALESCE(mp.restricted_level_count, mp.transactions_count))
       ELSE mp.transactions_count END AS level_transactions,
  (mp.verified_at IS NOT NULL)  AS is_verified,
  (mp.certified_at IS NOT NULL) AS is_certified,
  u.last_seen_at, u.created_at AS member_since
FROM mandataire_profiles mp
JOIN users u ON u.id = mp.user_id
WHERE u.role = 'mandataire'
  AND u.status = 'active'
  AND u.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM mandataire_accounts ma WHERE ma.mandataire_id = mp.id AND ma.status = 'published');
