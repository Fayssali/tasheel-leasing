import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          issuer: 'tasheel',
          audience: 'tasheel-api',
        },
        verifyOptions: { issuer: 'tasheel', audience: 'tasheel-api', algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController, AccountController],
  providers: [AuthService, AccountService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
