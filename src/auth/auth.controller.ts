import { Body, Controller, Post } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { AuthService } from './auth.service';

class SocialLoginDto {
  @IsIn(['google', 'facebook', 'line'])
  provider!: 'google' | 'facebook' | 'line';

  /** id_token (Google/LINE) or access_token (Facebook) obtained by the frontend. */
  @IsString()
  @IsNotEmpty()
  credential!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('social')
  async socialLogin(@Body() dto: SocialLoginDto) {
    const { token, user, isNewUser } = await this.auth.socialLogin(dto.provider, dto.credential);
    return {
      token,
      is_new_user: isNewUser,
      user: { id: user.id, email: user.email, display_name: user.displayName, avatar_url: user.avatarUrl },
    };
  }
}
