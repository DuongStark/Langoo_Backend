-- M14.4 — Backfill 100 pilot sense-level images uploaded on 2026-11-08.
-- Idempotent: safe to rerun; only pilot assets with a numeric source_sense_id.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

INSERT INTO core.sense_media
  (sense_id, asset_id, status, is_primary, style_id, source, reviewed_at, reviewed_by_label)
SELECT DISTINCT ON ((ma.metadata->>'source_sense_id')::bigint)
  (ma.metadata->>'source_sense_id')::bigint,
  ma.id,
  'approved',
  NOT EXISTS (
    SELECT 1
    FROM core.sense_media sm
    WHERE sm.sense_id = (ma.metadata->>'source_sense_id')::bigint
      AND sm.status = 'approved'
      AND sm.is_primary
  ),
  COALESCE(NULLIF(ma.metadata->>'style', ''), 'realistic-v3'),
  'pilot',
  now(),
  'project-owner:pilot-antislop-2026-11-08'
FROM core.media_asset ma
WHERE ma.metadata->>'pilot' = 'true'
  AND ma.metadata->>'source_sense_id' ~ '^[0-9]+$'
ORDER BY (ma.metadata->>'source_sense_id')::bigint, ma.id
ON CONFLICT (sense_id, asset_id) DO NOTHING;

COMMIT;
