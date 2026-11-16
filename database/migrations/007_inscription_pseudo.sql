-- =============================================================================
-- Migration 007 : les mandataires s'inscrivent avec un pseudo, comme les clients (ni nom, ni prénom,
-- ni téléphone). Nom et prénom restent obligatoires pour les administrateurs uniquement.
-- À appliquer sur une base installée avant cette modification (après la migration 006).
-- Une base installée avec le nouveau mandix.sql n'en a pas besoin.
-- Sélectionnez la base avant l'exécution (USE mandix;), ou passez par phpMyAdmin sur la bonne base.
-- =============================================================================

SET NAMES utf8mb4;

ALTER TABLE users DROP CHECK chk_users_identity;
ALTER TABLE users
  DROP COLUMN phone,
  MODIFY COLUMN pseudo VARCHAR(40) NULL COMMENT 'Clients et mandataires : nom affiché, choisi à l''inscription',
  MODIFY COLUMN first_name VARCHAR(80) NULL COMMENT 'Administrateurs',
  MODIFY COLUMN last_name VARCHAR(80) NULL COMMENT 'Administrateurs',
  ADD CONSTRAINT chk_users_identity CHECK (
    (role IN ('client','mandataire') AND pseudo IS NOT NULL)
    OR (role = 'admin' AND first_name IS NOT NULL AND last_name IS NOT NULL)
  );

-- La fiche publique affiche le pseudo du mandataire.
CREATE OR REPLACE VIEW v_public_mandataires AS
SELECT
  mp.id, mp.slug, u.pseudo, mp.country_code, mp.bio, mp.languages, mp.avatar_key,
  mp.rating_avg, mp.rating_count, mp.transactions_count,
  (mp.verified_at IS NOT NULL)  AS is_verified,
  (mp.certified_at IS NOT NULL) AS is_certified,
  u.last_seen_at, u.created_at AS member_since
FROM mandataire_profiles mp
JOIN users u ON u.id = mp.user_id
WHERE u.role = 'mandataire'
  AND u.status = 'active'
  AND u.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM mandataire_accounts ma WHERE ma.mandataire_id = mp.id AND ma.status = 'published');
