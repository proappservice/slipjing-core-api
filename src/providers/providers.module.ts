import { Module } from '@nestjs/common';
import { ProviderChainService } from './provider-chain.service';
import { Slip2GoAdapter } from './slip2go.adapter';

@Module({
  providers: [Slip2GoAdapter, ProviderChainService],
  exports: [ProviderChainService],
})
export class ProvidersModule {}
