import { Module } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import {
  ApplicationsController,
  ProductsController,
  ReviewController,
} from './financing.controllers';
import { ProductsService } from './products.service';
import { ReviewService } from './review.service';

@Module({
  controllers: [ProductsController, ApplicationsController, ReviewController],
  providers: [ProductsService, ApplicationsService, ReviewService],
})
export class FinancingModule {}
