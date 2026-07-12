import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { ShopGuard } from '../auth/shop.guard';
import { TopupService } from './topup.service';

class CreateOrderDto {
  @IsUUID()
  package_id!: string;
}

@Controller('shops/topup')
@UseGuards(ShopGuard)
export class TopupController {
  constructor(private readonly topup: TopupService) {}

  @Get('packages')
  packages() {
    return this.topup.listPackages();
  }

  @Post('orders')
  createOrder(@Body() dto: CreateOrderDto) {
    return this.topup.createOrder(dto.package_id);
  }

  @Get('orders')
  orders() {
    return this.topup.listOrders();
  }
}
