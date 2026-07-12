import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsIn, IsUrl } from 'class-validator';
import { ShopGuard } from '../auth/shop.guard';
import { WebhooksService } from './webhooks.service';

const SUPPORTED_EVENTS = ['verification.completed', 'topup.completed'] as const;

class CreateEndpointDto {
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  url!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(SUPPORTED_EVENTS, { each: true })
  events!: string[];
}

@Controller('shops/webhooks')
@UseGuards(ShopGuard)
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  list() {
    return this.webhooks.listEndpoints();
  }

  @Post()
  create(@Body() dto: CreateEndpointDto) {
    return this.webhooks.createEndpoint(dto.url, dto.events);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.webhooks.deleteEndpoint(id);
    return { removed: true };
  }
}
