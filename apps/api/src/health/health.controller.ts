import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Two probes, so an orchestrator can tell "the process is stuck" (restart it) from
 * "the database is unreachable" (stop sending traffic, do not restart in a loop).
 */
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Readiness: the API can serve requests (database reachable). Also used by the web footer. */
  @Get()
  @HttpCode(200)
  async check(): Promise<{ status: 'ok'; database: 'up'; time: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
    return { status: 'ok', database: 'up', time: new Date().toISOString() };
  }

  /** Liveness: the process answers. Touches nothing else. */
  @Get('live')
  @HttpCode(200)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
