-- Migration 0098: a controlled category for a partner dispute, and an approval flag for the document types a partner may upload.
-- Why: a partner dispute carries only a free-text reason, so staff cannot sort it by kind. A document type can be uploaded by staff
-- only, because nothing marks it as one a partner may send. Both changes are additive. Existing rows keep their values (category NULL,
-- partner_upload false), so no staff dispute and no document type changes meaning.
-- The API enforces the category set for partner disputes, and the flag for partner uploads. The list of approved document types is a
-- business decision and is pending (docs/CONNECTOR_PHASE1_CONTRACT.md). Not applied to hosted.

SET search_path = app, extensions, public;

ALTER TABLE dispute
  ADD COLUMN IF NOT EXISTS category text
    CHECK (category IS NULL OR category IN ('COMMISSION_CALCULATION', 'PAYOUT', 'OTHER'));

ALTER TABLE document_type
  ADD COLUMN IF NOT EXISTS partner_upload boolean NOT NULL DEFAULT false;
