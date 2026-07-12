import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { BankAccountsController, ShopsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [CreditsModule],
  controllers: [ShopsController, BankAccountsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
