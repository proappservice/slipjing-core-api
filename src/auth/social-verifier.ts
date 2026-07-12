import { AuthProvider } from '@prisma/client';
import { ApiError } from '../common/errors';

export interface SocialProfile {
  provider: AuthProvider;
  providerUserId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Verifies a social-provider credential (id_token / access_token from the
 * frontend OAuth flow) and returns the profile.
 *
 * Google  : verify id_token against https://oauth2.googleapis.com/tokeninfo
 * Facebook: verify access_token via graph.facebook.com/debug_token + /me
 * LINE    : verify id_token via https://api.line.me/oauth2/v2.1/verify
 *
 * All three are plain HTTPS calls — no SDK needed. Client IDs come from env.
 */
export class SocialVerifier {
  constructor(
    private readonly cfg: {
      googleClientId?: string;
      facebookAppId?: string;
      facebookAppSecret?: string;
      lineChannelId?: string;
    },
  ) {}

  async verify(provider: AuthProvider, credential: string): Promise<SocialProfile> {
    switch (provider) {
      case 'google':
        return this.verifyGoogle(credential);
      case 'facebook':
        return this.verifyFacebook(credential);
      case 'line':
        return this.verifyLine(credential);
    }
  }

  private async verifyGoogle(idToken: string): Promise<SocialProfile> {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!res.ok) throw ApiError.unauthorized('Google token verification failed');
    const p = (await res.json()) as Record<string, string>;
    if (this.cfg.googleClientId && p.aud !== this.cfg.googleClientId) {
      throw ApiError.unauthorized('Google token audience mismatch');
    }
    return {
      provider: 'google',
      providerUserId: p.sub,
      email: p.email ?? null,
      displayName: p.name ?? null,
      avatarUrl: p.picture ?? null,
    };
  }

  private async verifyFacebook(accessToken: string): Promise<SocialProfile> {
    const appToken = `${this.cfg.facebookAppId}|${this.cfg.facebookAppSecret}`;
    const dbg = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appToken)}`,
    );
    if (!dbg.ok) throw ApiError.unauthorized('Facebook token verification failed');
    const dbgBody = (await dbg.json()) as { data?: { is_valid?: boolean; user_id?: string } };
    if (!dbgBody.data?.is_valid || !dbgBody.data.user_id) throw ApiError.unauthorized('Facebook token is not valid');

    const me = await fetch(
      `https://graph.facebook.com/v19.0/me?fields=id,name,email,picture&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!me.ok) throw ApiError.unauthorized('Facebook profile fetch failed');
    const profile = (await me.json()) as { id: string; name?: string; email?: string; picture?: { data?: { url?: string } } };
    return {
      provider: 'facebook',
      providerUserId: profile.id,
      email: profile.email ?? null,
      displayName: profile.name ?? null,
      avatarUrl: profile.picture?.data?.url ?? null,
    };
  }

  private async verifyLine(idToken: string): Promise<SocialProfile> {
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: this.cfg.lineChannelId ?? '' }),
    });
    if (!res.ok) throw ApiError.unauthorized('LINE token verification failed');
    const p = (await res.json()) as Record<string, string>;
    return {
      provider: 'line',
      providerUserId: p.sub,
      email: p.email ?? null,
      displayName: p.name ?? null,
      avatarUrl: p.picture ?? null,
    };
  }
}
