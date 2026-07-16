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

class LineLoginDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  /** ต้องตรงกับ redirect_uri ที่ใช้ตอน authorize (LINE ตรวจซ้ำตอนแลก token) */
  @IsString()
  @IsNotEmpty()
  redirect_uri!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('social')
  async socialLogin(@Body() dto: SocialLoginDto) {
    return this.toResponse(await this.auth.socialLogin(dto.provider, dto.credential));
  }

  /** LINE Login v2.1: รับ authorization code จากหน้า callback ของเว็บ */
  @Post('line')
  async lineLogin(@Body() dto: LineLoginDto) {
    return this.toResponse(await this.auth.lineLogin(dto.code, dto.redirect_uri));
  }

  private toResponse({ token, user, isNewUser }: Awaited<ReturnType<AuthService['socialLogin']>>) {
    return {
      token,
      is_new_user: isNewUser,
      user: { id: user.id, email: user.email, display_name: user.displayName, avatar_url: user.avatarUrl },
    };
  }
}
