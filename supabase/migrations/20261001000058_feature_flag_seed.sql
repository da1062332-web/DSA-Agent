-- Migration: 20261001000058_feature_flag_seed.sql
-- Owner: Dev 1 (Module 1 / Module 40: platform administration)
-- Feature flags now live in app.feature_flag (they used to be a Map inside the service, lost on every restart). Migration 0046 seeded
-- four of the six flags the console shows; these are the other two, so nothing disappears from the console when it reads the table.
-- Idempotent: ON CONFLICT DO NOTHING leaves a flag that already exists, whatever an operator has set it to.

SET search_path = app, extensions, public;

INSERT INTO app.feature_flag (key, scope, value, owner, remove_by, description, lock_version, updated_by) VALUES
  ('crm.lead_auto_qualify', 'TENANT', false, 'CRM Squad', '2026-11-30', 'Automatic qualification when BRE score is above 750', 1, 'SYSTEM:migration'),
  ('whatsapp.notifications_enabled', 'GLOBAL', true, 'Messaging Squad', NULL, 'Real-time customer status notifications over WhatsApp', 1, 'SYSTEM:migration')
ON CONFLICT (key, scope) DO NOTHING;
