-- =============================================================================
-- Migration 011 : statistiques durables malgré la messagerie éphémère.
-- Les messages disparaissent 3 jours après la clôture ; les indicateurs du mandataire (délai de réponse, preuves
-- rejetées) sont donc enregistrés sur la transaction elle-même.
-- =============================================================================
ALTER TABLE transactions
  ADD COLUMN first_response_at DATETIME NULL COMMENT 'Première réponse du mandataire (demande du montant) : délai de réponse' AFTER proof_pending_since,
  ADD COLUMN proof_rejections SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Preuves de paiement rejetées pendant la transaction' AFTER first_response_at;
