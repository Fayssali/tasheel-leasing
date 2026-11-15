export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Second-step login token: 5 minutes to type the authenticator code. */
export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
export const MFA_CHALLENGE_AUDIENCE = 'tasheel-mfa';
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export const REFRESH_COOKIE = 'tasheel_rt';
/** The refresh cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** First administrator role given to the user who registers each organization type. */
export const ADMIN_ROLE_BY_TYPE = {
  SUPPLIER: 'supplier_admin',
  FINANCIAL_INSTITUTION: 'institution_admin',
  BUSINESS: 'business_admin',
} as const;
