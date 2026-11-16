import {
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

/** In-app notifications of the signed-in user, across all their organizations (RLS: own only). */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.forTenant({ organizationId: null, userId }, async (tx) => {
      const [items, unread] = await Promise.all([
        tx.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
        tx.notification.count({ where: { userId, readAt: null } }),
      ]);
      return { items, unread };
    });
  }

  async markRead(userId: string, id: string) {
    return this.prisma.forTenant({ organizationId: null, userId }, async (tx) => {
      const { count } = await tx.notification.updateMany({
        where: { id, userId },
        data: { readAt: new Date() },
      });
      if (!count)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Notification not found.' });
      return { id };
    });
  }

  markAllRead(userId: string) {
    return this.prisma.forTenant({ organizationId: null, userId }, async (tx) => {
      const { count } = await tx.notification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: new Date() },
      });
      return { updated: count };
    });
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.list(user.id);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user.id, id);
  }
}

@Module({ controllers: [NotificationsController], providers: [NotificationsService] })
export class NotificationsModule {}
