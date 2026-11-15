import { Global, Module } from '@nestjs/common';
import { Mailer, SmtpMailer } from './mailer';
import { Notifier } from './notifier';

@Global()
@Module({
  providers: [{ provide: Mailer, useClass: SmtpMailer }, Notifier],
  exports: [Mailer, Notifier],
})
export class MailModule {}
