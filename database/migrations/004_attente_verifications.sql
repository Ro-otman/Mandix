-- =============================================================================
-- Migration 004 : type d'envoi PayPal / mode de virement, délai de 7 jours pour un paiement « En attente »
-- (preuves de non-crédit, vérification par l'équipe Mandix), confirmation de réception avant l'évaluation.
-- À appliquer sur une base installée avec un mandix.sql antérieur au 12 novembre 2026 (après la migration 003).
-- Une base installée avec le nouveau mandix.sql n'en a pas besoin.
-- Sélectionnez la base avant l'exécution (USE mandix;), ou passez par phpMyAdmin sur la bonne base.
-- =============================================================================

SET NAMES utf8mb4;

-- Transactions : nouveaux statuts, option d'envoi, délai de 7 jours, réception confirmée
ALTER TABLE transactions
  MODIFY COLUMN status ENUM('awaiting_amount','awaiting_receive_details','awaiting_proof','proof_review','proof_pending',
                            'credit_evidence_requested','credit_evidence_sent','under_verification','disputed',
                            'awaiting_payout_details','awaiting_transfer','awaiting_receipt','awaiting_review',
                            'completed','cancelled') NOT NULL DEFAULT 'awaiting_amount',
  ADD COLUMN receive_option ENUM('friends_family','goods_services','instant','classic') NULL
    COMMENT 'PayPal : Amis et proches / Biens et services ; virement : instantané / classique' AFTER mandataire_account_id,
  ADD COLUMN proof_pending_since DATETIME NULL COMMENT 'Début du délai de 7 jours (En attente, ou relancé après confirmation)' AFTER payout_details_enc,
  ADD COLUMN receipt_confirmed_at DATETIME NULL COMMENT 'Le client a confirmé avoir reçu l''argent' AFTER transfer_sent_at;

-- Messages : nouveaux messages préfaits ; les fichiers sont désormais rattachés aux messages (plusieurs par message)
ALTER TABLE conversation_events DROP CHECK chk_conversation_events_file;
ALTER TABLE conversation_events DROP FOREIGN KEY fk_conversation_events_attachment;
ALTER TABLE conversation_events
  DROP COLUMN attachment_id,
  MODIFY COLUMN event_type ENUM('request','ask_amount','amount','receive_info','proof','proof_status',
                                'credit_proof_request','credit_proof','credit_proof_ok','verification_request',
                                'verification_result','payout_info','sent','receipt','review') NOT NULL;

ALTER TABLE attachments
  MODIFY COLUMN kind ENUM('payment_proof','transfer_proof','credit_evidence') NOT NULL,
  MODIFY COLUMN decision ENUM('pending','validated','rejected') NULL COMMENT 'Preuve de paiement : Validé, Rejeté ou En attente',
  ADD COLUMN event_id BIGINT UNSIGNED NULL COMMENT 'Message auquel le fichier est joint' AFTER transaction_id,
  ADD KEY idx_attachments_event (event_id),
  ADD CONSTRAINT fk_attachments_event FOREIGN KEY (event_id) REFERENCES conversation_events (id);

-- Demandes de vérification (espace admin, « Vérifications »)
CREATE TABLE IF NOT EXISTS verification_requests (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reference         VARCHAR(20)     NOT NULL COMMENT 'Ex. VR-2026-000012',
  transaction_id    BIGINT UNSIGNED NOT NULL,
  conversation_id   BIGINT UNSIGNED NOT NULL,
  client_id         BIGINT UNSIGNED NOT NULL,
  mandataire_id     BIGINT UNSIGNED NOT NULL,
  request_event_id  BIGINT UNSIGNED NOT NULL COMMENT 'Message « demander une vérification »',
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
  CONSTRAINT fk_verification_requests_event        FOREIGN KEY (request_event_id) REFERENCES conversation_events (id),
  CONSTRAINT fk_verification_requests_decider      FOREIGN KEY (decided_by)       REFERENCES users (id),
  CONSTRAINT chk_verification_requests_decision CHECK (status = 'open' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE notifications
  MODIFY COLUMN type VARCHAR(50) NOT NULL COMMENT 'message.new, transaction.proof, transaction.sent, review.received, account.published, verification.result…';
