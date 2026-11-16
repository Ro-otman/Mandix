-- =============================================================================
-- Migration 009 : messagerie temps réel, éphémère et chiffrée
--   * conversation_events : le contenu de chaque message est chiffré (payload_enc, AES-256-GCM) ; les anciennes
--     colonnes en clair (payload, secure_payload_enc) disparaissent ;
--   * les messages sont effacés 3 jours après la clôture de leur transaction : le déclencheur qui interdisait
--     la suppression est retiré (la modification reste interdite) ;
--   * pièces jointes et demandes de vérification survivent à l'effacement de leur message (ON DELETE SET NULL).
-- À appliquer après la migration 008. Base sans messages existants (les anciens messages en clair seraient perdus).
-- =============================================================================

SET NAMES utf8mb4;

ALTER TABLE conversation_events
  DROP COLUMN payload,
  DROP COLUMN secure_payload_enc,
  ADD COLUMN payload_enc VARBINARY(4096) NOT NULL
    COMMENT 'Contenu du message chiffré (AES-256-GCM, contexte event:<conversation>), jamais en clair' AFTER event_type;

DROP TRIGGER IF EXISTS trg_conversation_events_no_delete;

ALTER TABLE attachments DROP FOREIGN KEY fk_attachments_event;
ALTER TABLE attachments
  ADD CONSTRAINT fk_attachments_event FOREIGN KEY (event_id) REFERENCES conversation_events (id) ON DELETE SET NULL;

ALTER TABLE verification_requests DROP FOREIGN KEY fk_verification_requests_event;
ALTER TABLE verification_requests
  MODIFY request_event_id BIGINT UNSIGNED NULL COMMENT 'Message « demander une vérification » (NULL une fois le message effacé)',
  ADD CONSTRAINT fk_verification_requests_event FOREIGN KEY (request_event_id) REFERENCES conversation_events (id) ON DELETE SET NULL;
