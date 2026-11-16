-- =============================================================================
-- Migration 010 : statut « requested » (le client a choisi un compte, le mandataire doit demander le montant).
-- Le statut de la transaction est la seule référence de l'étape en cours : les messages, éphémères, peuvent
-- disparaître sans que le parcours ne soit perdu.
-- =============================================================================
ALTER TABLE transactions
  MODIFY status ENUM('requested','awaiting_amount','awaiting_receive_details','awaiting_proof','proof_review','proof_pending',
                     'credit_evidence_requested','credit_evidence_sent','under_verification','disputed',
                     'awaiting_payout_details','awaiting_transfer','awaiting_receipt','awaiting_review',
                     'completed','cancelled') NOT NULL DEFAULT 'requested';
