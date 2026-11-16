-- =============================================================================
-- Migration 005 : le client choisit aussi l'option de son compte de réception (PayPal : Amis et proches /
-- Biens et services ; virement : instantané / classique), comme le mandataire pour ses coordonnées.
-- À appliquer sur une base installée avant cette modification (après la migration 004).
-- Une base installée avec le nouveau mandix.sql n'en a pas besoin.
-- Sélectionnez la base avant l'exécution (USE mandix;), ou passez par phpMyAdmin sur la bonne base.
-- =============================================================================

SET NAMES utf8mb4;

ALTER TABLE transactions
  MODIFY COLUMN receive_option ENUM('friends_family','goods_services','instant','classic') NULL
    COMMENT 'Option choisie par le mandataire : PayPal Amis et proches / Biens et services ; virement instantané / classique',
  ADD COLUMN payout_option ENUM('friends_family','goods_services','instant','classic') NULL
    COMMENT 'Option choisie par le client pour recevoir l''argent (PayPal, virement)' AFTER payout_details_enc;
