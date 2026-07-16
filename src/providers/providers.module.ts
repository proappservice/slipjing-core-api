import { Module } from '@nestjs/common';
import { ProviderChainService } from './provider-chain.service';
import { Slip2GoAdapter } from './slip2go.adapter';
import { ThunderAdapter } from './thunder.adapter';

@Module({
  providers: [ThunderAdapter, Slip2GoAdapter, ProviderChainService],
  exports: [ProviderChainService],
})
export class ProvidersModule {}
