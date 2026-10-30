-- M14.1: owner requested image bindings without concept pre-review.
-- Only image visibility changes; dictionary/pair gates and concept states stay intact.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE OR REPLACE VIEW serve.concept_image AS
SELECT cm.concept_id, cm.asset_id, cm.anchor_sense_id,
       ma.object_key, ma.mime, ma.bytes, ma.sha256, ma.provider
FROM core.concept_media cm
JOIN core.concept c ON c.id = cm.concept_id AND c.status IN ('draft', 'curated')
JOIN core.media_asset ma ON ma.id = cm.asset_id AND ma.kind = 'concept_image'
JOIN core.sense_concept sc ON sc.sense_id = cm.anchor_sense_id AND sc.concept_id = cm.concept_id
  AND sc.relation = 'exact' AND sc.verified AND sc.confidence >= 0.7
WHERE cm.status = 'approved' AND cm.is_primary;
COMMENT ON VIEW serve.concept_image IS
  'M14.1 default-accept images: draft/curated concepts, approved primary image and current verified exact anchor; review/rejected hidden.';
