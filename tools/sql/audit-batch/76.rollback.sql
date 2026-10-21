-- Roll back migration 0076. Refused once a subscription stores an encrypted secret or is FAILING, or a delivery recorded an error.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'webhook_subscription' AND column_name = 'secret_ciphertext') THEN
    IF EXISTS (SELECT 1 FROM app.webhook_subscription WHERE secret_ciphertext IS NOT NULL OR status = 'FAILING' OR last_failure_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Rollback aborted: subscriptions hold secrets or failure state. Manual review required.';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'webhook_delivery_log' AND column_name = 'last_error') THEN
    IF EXISTS (SELECT 1 FROM app.webhook_delivery_log WHERE last_error IS NOT NULL) THEN
      RAISE EXCEPTION 'Rollback aborted: deliveries recorded errors. Manual review required.';
    END IF;
  END IF;
END $$;
DROP INDEX IF EXISTS app.webhook_delivery_tenant_created_idx;
DROP INDEX IF EXISTS app.webhook_delivery_once_uq;
ALTER TABLE app.webhook_delivery_log DROP COLUMN IF EXISTS last_error, DROP COLUMN IF EXISTS updated_at;
ALTER TABLE app.webhook_subscription DROP CONSTRAINT IF EXISTS webhook_subscription_status_check;
ALTER TABLE app.webhook_subscription ADD CONSTRAINT webhook_subscription_status_check CHECK (status IN ('ACTIVE', 'PAUSED', 'REVOKED'));
ALTER TABLE app.webhook_subscription DROP COLUMN IF EXISTS secret_ciphertext, DROP COLUMN IF EXISTS last_failure_at;
COMMIT;
