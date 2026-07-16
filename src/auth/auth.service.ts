import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthProvider, User } from '@prisma/client';
import { ApiError } from '../common/errors';
import { newId } from '../common/ids';
import { PrismaService } from '../common/prisma.service';
import { SocialVerifier } from './social-verifier';

export interface SessionClaims {
  sub: string; // user id
  email: string;
}

@Injectable()
export class AuthService {
  private readonly verifier: SocialVerifier;
  private readonly lineChannelId?: string;
  private readonly lineChannelSecret?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.lineChannelId = config.get<string>('LINE_CHANNEL_ID');
    this.lineChannelSecret = config.get<string>('LINE_CHANNEL_SECRET');
    this.verifier = new SocialVerifier({
      googleClientId: config.get<string>('GOOGLE_CLIENT_ID'),
      facebookAppId: config.get<string>('FACEBOOK_APP_ID'),
      facebookAppSecret: config.get<string>('FACEBOOK_APP_SECRET'),
      lineChannelId: this.lineChannelId,
    });
  }

  /**
   * LINE Login v2.1 (authorization code flow): exchange the code for an
   * id_token using the channel secret (server-side only), then continue
   * through the normal social-login path.
   */
  async lineLogin(code: string, redirectUri: string): Promise<{ token: string; user: User; isNewUser: boolean }> {
    if (!this.lineChannelId || !this.lineChannelSecret) {
      throw ApiError.invalidRequest('LINE login is not configured (LINE_CHANNEL_ID / LINE_CHANNEL_SECRET)');
    }
    const res = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: this.lineChannelId,
        client_secret: this.lineChannelSecret,
      }),
    });
    const body = (await res.json().catch(() => null)) as { id_token?: string; error_description?: string } | null;
    if (!res.ok || !body?.id_token) {
      throw ApiError.unauthorized(`LINE code exchange failed${body?.error_description ? `: ${body.error_description}` : ''}`);
    }
    return this.socialLogin('line', body.id_token);
  }

  /**
   * Social login (the only auth path in Phase 1): verify the provider
   * credential, find-or-create the user + identity, return our JWT.
   * NOTE: runs pre-tenant — direct prisma access here is intentional.
   */
  async socialLogin(provider: AuthProvider, credential: string): Promise<{ token: string; user: User; isNewUser: boolean }> {
    const profile = await this.verifier.verify(provider, credential);

    const existing = await this.prisma.authIdentity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId: profile.providerUserId } },
      include: { user: true },
    });

    let user: User;
    let isNewUser = false;

    if (existing) {
      user = existing.user;
    } else {
      // Link to an existing user by verified email, else create a new user.
      const byEmail = profile.email ? await this.prisma.user.findUnique({ where: { email: profile.email } }) : null;
      user =
        byEmail ??
        (await this.prisma.user.create({
          data: {
            id: newId(),
            email: profile.email ?? `${provider}:${profile.providerUserId}@no-email.slipjing.local`,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
          },
        }));
      isNewUser = !byEmail;
      await this.prisma.authIdentity.create({
        data: {
          id: newId(),
          userId: user.id,
          provider,
          providerUserId: profile.providerUserId,
          emailAtLink: profile.email,
        },
      });
    }

    const claims: SessionClaims = { sub: user.id, email: user.email };
    return { token: await this.jwt.signAsync(claims), user, isNewUser };
  }

  async verifySession(token: string): Promise<SessionClaims> {
    return this.jwt.verifyAsync<SessionClaims>(token);
  }
}
