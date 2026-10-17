-- Roll back migration 0058. Only flags nobody has touched since the migration seeded them are removed.
BEGIN;
SET search_path = app, extensions, public;
DELETE FROM app.feature_flag
 WHERE ((key = 'crm.lead_auto_qualify' AND scope = 'TENANT') OR (key = 'whatsapp.notifications_enabled' AND scope = 'GLOBAL'))
   AND updated_by = 'SYSTEM:migration' AND lock_version = 1;
COMMIT;
