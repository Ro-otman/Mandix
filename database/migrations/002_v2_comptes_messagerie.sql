-- =============================================================================
-- Migration 002 : passage d'une base créée avec le schéma version 1 (rendez-vous, demandes, services,
-- justificatifs, réclamations…) à la version 2 (comptes de paiement, messagerie guidée, transactions).
--
-- ATTENTION : supprime TOUTES les tables et vues de la version 1, données comprises.
-- À utiliser uniquement sur une base de développement ou de démonstration sans données réelles
-- (aucune donnée réelle n'a été enregistrée à ce stade du projet). Sur une base contenant des données
-- réelles, écrivez une migration de reprise de données à la place.
--
-- Ensuite : npm run db:setup (applique database/schema.sql puis les seeds).
-- Sélectionnez la base avant l'exécution (USE mandix;), ou passez par phpMyAdmin sur la bonne base.
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Vues de la version 1
DROP VIEW IF EXISTS v_public_reviews, v_public_qualifications, v_public_mandataire_services,
  v_public_mandataire_institutions, v_public_mandataires;

-- Déclencheurs de la version 1
DROP TRIGGER IF EXISTS trg_request_events_no_update;
DROP TRIGGER IF EXISTS trg_audit_logs_no_update;
DROP TRIGGER IF EXISTS trg_audit_logs_no_delete;

-- Tables supprimées du produit
DROP TABLE IF EXISTS
  appointments, request_events, requests,                      -- rendez-vous et demandes
  availability_exceptions, availability,                       -- disponibilités
  revenue_declarations,                                        -- revenus déclarés
  complaint_notes, complaint_attachments, complaints,          -- réclamations et signalements
  security_alerts,                                             -- alertes (page Sécurité retirée)
  mandataire_services, services, service_categories,           -- services et offres
  mandataire_institutions, qualifications, verification_documents, partner_institutions, -- vérifications
  mandataire_zones, mandataire_experiences, cities,            -- villes, zones, expériences
  client_profiles;                                             -- le pseudo est désormais dans users

-- Tables dont la structure change : recréées par schema.sql
DROP TABLE IF EXISTS reviews, notifications, mandataire_profiles, admin_profiles, user_tokens,
  login_attempts, audit_logs, users;

-- La table des sessions (express-mysql-session) est conservée telle quelle.

SET FOREIGN_KEY_CHECKS = 1;
