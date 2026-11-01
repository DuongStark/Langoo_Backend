export interface ImageContract {
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
}

export interface ImageCandidate {
  asset_id?: bigint;
  concept_id?: bigint;
  anchor_sense_id?: bigint;
  object_key: string;
  mime: string;
  bytes?: number | null;
  sha256?: string | null;
  provider?: string | null;
  metadata?: unknown;
}

export interface SenseImageSource {
  sense_id: bigint;
  lemma: string;
  pos: string | null;
  language_id: number;
  definition: string;
  directCandidate: ImageCandidate | null;
}

export interface RootResolutionRow {
  source_sense_id: bigint;
  target_sense_id: bigint;
  method: string;
  confidence: number;
  target_language_id?: number;
  target_pos?: string | null;
  target_lemma?: string;
  target_definition?: string;
}
