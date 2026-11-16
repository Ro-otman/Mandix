-- =============================================================================
-- Migration 006 : l'évaluation du client n'est plus un message de la conversation. Elle est enregistrée
-- uniquement dans la table reviews (note moyenne du mandataire), sans être envoyée au mandataire.
-- À appliquer sur une base installée avant cette modification (après la migration 005).
-- Une base installée avec le nouveau mandix.sql n'en a pas besoin.
-- Sélectionnez la base avant l'exécution (USE mandix;), ou passez par phpMyAdmin sur la bonne base.
-- =============================================================================

SET NAMES utf8mb4;

-- Messages d'évaluation éventuels (bases de test) : la table conversation_events est en ajout seul,
-- ses déclencheurs interdisent la suppression ; on les lève le temps de la migration.
DROP TRIGGER IF EXISTS trg_conversation_events_no_delete;
DELETE FROM conversation_events WHERE event_type = 'review';
CREATE TRIGGER trg_conversation_events_no_delete BEFORE DELETE ON conversation_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'conversation_events : suppression interdite';

ALTER TABLE conversation_events
  MODIFY COLUMN event_type ENUM('request','ask_amount','amount','receive_info','proof','proof_status',
                                'credit_proof_request','credit_proof','credit_proof_ok','verification_request',
                                'verification_result','payout_info','sent','receipt') NOT NULL;
