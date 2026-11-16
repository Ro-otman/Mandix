-- =============================================================================
-- Migration 003 : le client saisit le montant de la transaction (plus de tranches préfaites).
-- À appliquer sur une base installée avec database/mandix.sql du 11 novembre 2026 (version 2),
-- avant cette modification. Une base installée ensuite avec le nouveau mandix.sql n'en a pas besoin.
-- Sélectionnez la base avant l'exécution (USE mandix;), ou passez par phpMyAdmin sur la bonne base.
-- =============================================================================

SET NAMES utf8mb4;

ALTER TABLE transactions
  DROP CHECK chk_transactions_amount,
  DROP COLUMN amount_min,
  DROP COLUMN amount_max,
  DROP COLUMN amount_max_eur,
  ADD COLUMN amount DECIMAL(14,2) NULL COMMENT 'Montant saisi par le client dans la messagerie' AFTER currency,
  ADD COLUMN amount_eur DECIMAL(12,2) NULL COMMENT 'Contre-valeur en euros, contrôlée contre le plafond' AFTER amount,
  MODIFY COLUMN currency CHAR(3) NULL COMMENT 'Devise du montant (par défaut celle du compte)',
  MODIFY COLUMN limit_eur DECIMAL(12,2) NULL COMMENT 'Plafond au moment de la demande (NULL : niveau 7, sans plafond)',
  ADD CONSTRAINT chk_transactions_amount CHECK (amount IS NULL OR amount > 0),
  ADD CONSTRAINT chk_transactions_limit CHECK (amount_eur IS NULL OR limit_eur IS NULL OR amount_eur <= limit_eur);
