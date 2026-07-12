import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { CreditsController, ShopCreditsController } from './credits.controller';
import { CreditsService } from './credits.service';

@Module({
  imports: [ApiKeysModule],
  controllers: [CreditsController, ShopCreditsController],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
