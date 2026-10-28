/** Claims trong access token JWT. */
export interface JwtPayload {
  /** User id (bigint chỉ có thể nằm trong JWT dưới dạng chuỗi). */
  sub: string;
  /** Id của session (app.user_session). */
  sid: string;
  /** Loại token — chỉ chấp nhận 'access' để phân biệt với token khác. */
  typ: 'access';
  iat?: number;
  exp?: number;
}

/** Cặp token trả về cho client (refresh token chỉ hiển thị 1 lần). */
export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface UserIdentitySummary {
  provider: string;
  created_at: string;
}

export interface UserResponse {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  status: string;
  created_at: string;
  last_login_at: string | null;
  identities: UserIdentitySummary[];
  has_password: boolean;
  has_google: boolean;
}

export interface AuthResult extends AuthTokens {
  user: UserResponse;
}

export interface GoogleLinkResult {
  provider: 'google';
  linked_at: string;
}

export interface GoogleOAuthChallengeResult {
  challenge_id: string;
  nonce: string;
  binding_secret: string;
  expires_in: number;
}

export interface SessionResponse {
  id: string;
  revoked_at: string | null;
}
