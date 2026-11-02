-- Migration 0100: a partner dispute must say what kind of dispute it is.
-- Why: 0098 made dispute.category optional, because internal disputes have no category and historical rows have none. The API has always
-- required a category for a partner dispute. This makes the database refuse a new partner dispute without one as well.
-- NOT VALID: the rule applies to rows written from now on. Partner disputes created before 0098 keep a NULL category until a backfill decision
-- is made; VALIDATE CONSTRAINT then. Nothing is updated or removed here. Not applied to hosted. Idempotent.

SET search_path = app, extensions, public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispute_partner_category_required' AND conrelid = 'app.dispute'::regclass) THEN
    ALTER TABLE dispute ADD CONSTRAINT dispute_partner_category_required
      CHECK (party_type <> 'CONNECTOR' OR category IS NOT NULL) NOT VALID;
  END IF;
END $$;
