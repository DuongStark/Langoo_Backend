-- M14.1 — R2 illustration metadata and explicit concept bindings.
-- Apply only after owner approval; operational importer writes core, API remains read-only.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE core.media_asset
  DROP CONSTRAINT media_asset_kind_check,
  ADD CONSTRAINT media_asset_kind_check
    CHECK (kind IN ('stroke_svg', 'stroke_gif', 'audio_tts', 'concept_image')),
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT media_asset_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  ADD CONSTRAINT media_asset_image_integrity CHECK (
    kind <> 'concept_image' OR (
      mime IN ('image/png', 'image/jpeg', 'image/webp')
      AND bytes IS NOT NULL AND bytes > 0
      AND sha256 IS NOT NULL AND sha256 ~ '^[0-9a-f]{64}$'
    )
  );

CREATE TABLE core.concept_media (
  concept_id bigint NOT NULL REFERENCES core.concept(id) ON DELETE RESTRICT,
  asset_id bigint NOT NULL REFERENCES core.media_asset(id) ON DELETE RESTRICT,
  anchor_sense_id bigint NOT NULL REFERENCES core.sense(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_label text CHECK (reviewed_by_label IS NULL OR btrim(reviewed_by_label) <> ''),
  PRIMARY KEY (concept_id, asset_id),
  CONSTRAINT concept_media_review_pair CHECK ((reviewed_at IS NULL) = (reviewed_by_label IS NULL)),
  CONSTRAINT concept_media_approved_review CHECK (status <> 'approved' OR reviewed_at IS NOT NULL),
  CONSTRAINT concept_media_primary_approved CHECK (NOT is_primary OR status = 'approved')
);
CREATE UNIQUE INDEX concept_media_one_primary ON core.concept_media(concept_id)
  WHERE is_primary AND status = 'approved';
CREATE INDEX concept_media_anchor ON core.concept_media(anchor_sense_id);

-- No composite FK to sense_concept: M14 may correct/remove a bad mapping.
-- Its removal or change immediately hides the illustration through this view.
CREATE VIEW serve.concept_image AS
SELECT cm.concept_id, cm.asset_id, cm.anchor_sense_id,
       ma.object_key, ma.mime, ma.bytes, ma.sha256, ma.provider
FROM core.concept_media cm
JOIN core.concept c ON c.id = cm.concept_id AND c.status = 'curated'
JOIN core.media_asset ma ON ma.id = cm.asset_id AND ma.kind = 'concept_image'
JOIN core.sense_concept sc ON sc.sense_id = cm.anchor_sense_id AND sc.concept_id = cm.concept_id
  AND sc.relation = 'exact' AND sc.verified AND sc.confidence >= 0.7
WHERE cm.status = 'approved' AND cm.is_primary;

COMMENT ON COLUMN core.media_asset.metadata IS
  'Storage bucket, generator/prompt provenance, original sense, dimensions; never credentials or expiring URLs.';
COMMENT ON TABLE core.concept_media IS
  'M14.1 explicit illustration binding; no automatic concept curation or primary replacement.';
