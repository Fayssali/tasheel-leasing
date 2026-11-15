import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Mail transport abstraction. Injected as a class token so tests and future providers
 * (or a queue-backed sender in Phase 6) can replace it.
 */
export abstract class Mailer {
  abstract send(mail: OutgoingMail): Promise<void>;
}

/** SMTP transport. Locally this is Mailpit (http://localhost:8025); in production, the chosen provider. */
@Injectable()
export class SmtpMailer extends Mailer {
  private readonly logger = new Logger(SmtpMailer.name);
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    super();
    this.from = config.get<string>('MAIL_FROM') ?? 'Tasheel Leasing <no-reply@tasheel.local>';
    this.transport = createTransport({
      host: config.get<string>('SMTP_HOST') ?? 'localhost',
      port: Number(config.get<string>('SMTP_PORT') ?? 1025),
      secure: config.get<string>('SMTP_SECURE') === 'true',
      auth: config.get<string>('SMTP_USER')
        ? {
            user: config.get<string>('SMTP_USER')!,
            pass: config.get<string>('SMTP_PASSWORD') ?? '',
          }
        : undefined,
    });
  }

  async send(mail: OutgoingMail): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...mail });
    // Log the recipient's domain only: email addresses are personal data.
    this.logger.log(`Mail "${mail.subject}" sent to *@${mail.to.split('@')[1] ?? '?'}`);
  }
}
