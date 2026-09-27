export interface ProfileResponse {
  id: string;
  name: string;
  primary_language_id: number;
  secondary_language_id: number | null;
  support_language_id: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeletedProfileResponse {
  id: string;
  deleted_at: string;
}

export interface SettingsResponse {
  timezone: string;
  ui_language_id: number | null;
  daily_goal: number;
  notify: Record<string, unknown>;
  active_profile_id: string | null;
  updated_at: string | null;
}
