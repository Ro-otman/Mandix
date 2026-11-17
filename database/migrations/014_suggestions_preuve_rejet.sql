-- =============================================================================
-- Migration 014 : suggestions, preuve du rejet, fenêtre « Comprendre les niveaux ». MySQL 8 et MariaDB.
--
-- 1. Suggestions des clients et des mandataires (« ce que l'équipe devrait améliorer ou modifier ») :
--    visibles uniquement par l'équipe Mandix (espace administrateur).
-- 2. « Rejeté : C'est pas bon ❌ » : le mandataire joint obligatoirement une preuve du rejet (capture,
--    document…), visible par le client. Le client choisit ensuite : Attendre, Je laisse, Je renvoie ma preuve
--    (1er rejet) ; Attendre, Je laisse, Faire vérifier ce mandataire (2e rejet).
-- 3. Fenêtre d'explication des niveaux : affichée une fois à l'arrivée dans l'espace mandataire.
-- =============================================================================

CREATE TABLE IF NOT EXISTS suggestions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NULL COMMENT 'Auteur (NULL si son compte a été supprimé)',
  author_role  ENUM('client','mandataire') NOT NULL,
  topic        ENUM('feature','design','problem','other') NOT NULL DEFAULT 'other',
  message      VARCHAR(2000) NOT NULL,
  status       ENUM('new','read','done') NOT NULL DEFAULT 'new' COMMENT 'Suivi par l''équipe',
  read_at      DATETIME NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_suggestions_status (status, created_at),
  KEY idx_suggestions_author (user_id, created_at),
  CONSTRAINT fk_suggestions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE attachments
  MODIFY kind ENUM('payment_proof','transfer_proof','credit_evidence','rejection_proof') NOT NULL;

ALTER TABLE mandataire_profiles
  ADD COLUMN levels_intro_seen_at DATETIME NULL
      COMMENT 'Fenêtre « Comprendre les niveaux » fermée par le mandataire' AFTER restricted_level_count;
