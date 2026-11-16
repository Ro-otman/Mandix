-- =============================================================================
-- Migration 012 : tarifs des comptes des mandataires.
-- À l'ajout d'un compte, le mandataire coche ce qu'il propose :
--   - E-mail et/ou RIB pour recevoir l'argent (coordonnées chiffrées, dans receive_details_enc) ;
--   - « Prix sur 100 » : pour 100 unités d'une devise (symbole choisi par le mandataire : €, $…), le montant
--     qu'il verse, avec son unité (ex. 100 € = 65 000 FCFA) ;
--   - « Pourcentage » prélevé sur la transaction (ex. 25 %).
-- Les tarifs sont publics : ils s'affichent sur le profil du mandataire.
-- =============================================================================
ALTER TABLE mandataire_accounts
  ADD COLUMN rate_symbol VARCHAR(8)    NULL COMMENT 'Prix sur 100 : symbole de la devise des 100 (€, $, £…)' AFTER bank_name,
  ADD COLUMN rate_amount DECIMAL(15,2) NULL COMMENT 'Prix sur 100 : montant versé pour 100 unités' AFTER rate_symbol,
  ADD COLUMN rate_unit   VARCHAR(12)   NULL COMMENT 'Prix sur 100 : unité du montant (FCFA, F, XOF…)' AFTER rate_amount,
  ADD COLUMN fee_percent DECIMAL(5,2)  NULL COMMENT 'Pourcentage prélevé sur la transaction' AFTER rate_unit,
  ADD CONSTRAINT chk_mandataire_accounts_rate CHECK (
    (rate_symbol IS NULL AND rate_amount IS NULL AND rate_unit IS NULL)
    OR (rate_symbol IS NOT NULL AND rate_amount > 0 AND rate_unit IS NOT NULL)
  ),
  ADD CONSTRAINT chk_mandataire_accounts_fee CHECK (fee_percent IS NULL OR (fee_percent > 0 AND fee_percent <= 100));

CREATE OR REPLACE VIEW v_public_mandataire_accounts AS
SELECT
  ma.id, ma.mandataire_id, t.slug AS type_slug, t.name AS type_name, t.logo_path, t.logo_storage_key,
  ma.country_code, ma.currency, ma.bank_name, ma.rate_symbol, ma.rate_amount, ma.rate_unit, ma.fee_percent, ma.published_at
FROM mandataire_accounts ma
JOIN v_public_mandataires pm ON pm.id = ma.mandataire_id
JOIN account_types t         ON t.id = ma.account_type_id AND t.is_active = 1
WHERE ma.status = 'published';
