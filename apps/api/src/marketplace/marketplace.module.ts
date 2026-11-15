import { Module } from '@nestjs/common';
import { CatalogueService } from './catalogue.service';
import { ListingsService } from './listings.service';
import {
  FavouritesController,
  MarketplaceAdminController,
  MarketplaceController,
  SupplierListingsController,
} from './marketplace.controllers';
import { SettingsService } from './settings.service';

@Module({
  controllers: [
    MarketplaceController,
    SupplierListingsController,
    FavouritesController,
    MarketplaceAdminController,
  ],
  providers: [CatalogueService, ListingsService, SettingsService],
  exports: [CatalogueService, ListingsService],
})
export class MarketplaceModule {}
