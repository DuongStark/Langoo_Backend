-- M14.4 — Sense-level vocabulary images.
-- Preferred path for deck/vocabulary illustrations; concept images stay as fallback.
-- Apply only after owner approval. Backfill pilot separately.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE core.sense_media (
  sense_id bigint NOT NULL REFERENCES core.sense(id) ON DELETE CASCADE,
  asset_id bigint NOT NULL REFERENCES core.media_asset(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  is_primary boolean NOT NULL DEFAULT false,
  style_id text,
  source text NOT NULL DEFAULT 'vocab-batch' CHECK (btrim(source) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_label text CHECK (reviewed_by_label IS NULL OR btrim(reviewed_by_label) <> ''),
  PRIMARY KEY (sense_id, asset_id),
  CONSTRAINT sense_media_review_pair CHECK ((reviewed_at IS NULL) = (reviewed_by_label IS NULL)),
  CONSTRAINT sense_media_approved_review CHECK (status <> 'approved' OR reviewed_at IS NOT NULL),
  CONSTRAINT sense_media_primary_approved CHECK (NOT is_primary OR status = 'approved')
);

CREATE UNIQUE INDEX sense_media_one_primary ON core.sense_media(sense_id)
  WHERE is_primary AND status = 'approved';
CREATE INDEX sense_media_asset ON core.sense_media(asset_id);

CREATE VIEW serve.sense_image AS
SELECT
  sm.sense_id,
  sm.asset_id,
  sm.style_id,
  sm.source,
  ma.object_key,
  ma.mime,
  ma.bytes,
  ma.sha256,
  ma.provider
FROM core.sense_media sm
JOIN core.media_asset ma ON ma.id = sm.asset_id AND ma.kind = 'concept_image'
WHERE sm.status = 'approved'
  AND sm.is_primary;

COMMENT ON TABLE core.sense_media IS
  'M14.4 explicit sense-level illustration binding; one approved primary per sense. Does not require concept mapping.';
COMMENT ON VIEW serve.sense_image IS
  'Read-only API view: approved primary sense image, independent of concept image.';
