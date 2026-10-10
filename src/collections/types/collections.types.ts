export interface CollectionResponse {
  id: string;
  profile_id: string;
  owner_id: string;
  name: string;
  description: string | null;
  kind: string;
  cloned_from_deck_id: string | null;
  cloned_from_collection_id: string | null;
  is_public: boolean;
  item_count: number;
  visible_item_count: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface CollectionListResult {
  data: CollectionResponse[];
  next_cursor: string | null;
}

export interface ArchivedResponse {
  id: string;
  archived_at: string;
}

export interface DeletedResponse {
  id: string;
  deleted_at: string;
}

export interface TagResponse {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface TagListResult {
  data: TagResponse[];
  next_cursor: string | null;
}

export interface ItemFaceResponse {
  id: string;
  sense_id: string;
  language_id: number;
  role: string;
}

export interface ItemResponse {
  id: string;
  collection_id: string;
  concept_id: string | null;
  anchor_sense_id: string;
  display_sense_id: string | null;
  meaning_vi: string;
  meaning_source: string;
  note: string | null;
  status: string;
  position: number;
  added_from_deck_id: string | null;
  created_at: string;
  updated_at: string;
  faces: ItemFaceResponse[];
  tag_ids: string[];
}

export interface ItemListResult {
  data: ItemResponse[];
  next_cursor: string | null;
}
