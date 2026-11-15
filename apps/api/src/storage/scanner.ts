import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'node:net';

export type ScanVerdict =
  { status: 'CLEAN' } | { status: 'INFECTED'; signature: string } | { status: 'NOT_SCANNED' };

/** Antivirus port. Production uses ClamAV; development may disable scanning (marked NOT_SCANNED). */
export abstract class Scanner {
  abstract scan(file: Buffer): Promise<ScanVerdict>;
}

/** Scanning disabled (development only — refused in production by the env check). */
@Injectable()
export class DisabledScanner extends Scanner {
  async scan(): Promise<ScanVerdict> {
    return { status: 'NOT_SCANNED' };
  }
}

/**
 * clamd INSTREAM protocol over TCP: "zINSTREAM\0", then chunks prefixed by their length
 * (uint32 big-endian), then a zero-length chunk. Reply: "stream: OK" or "stream: <sig> FOUND".
 * If clamd cannot be reached the upload is refused: nothing unscanned is stored in production.
 */
@Injectable()
export class ClamAvScanner extends Scanner {
  private readonly logger = new Logger(ClamAvScanner.name);
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    super();
    this.host = config.get<string>('CLAMAV_HOST') ?? 'localhost';
    this.port = Number(config.get<string>('CLAMAV_PORT') ?? 3310);
    this.timeoutMs = Number(config.get<string>('CLAMAV_TIMEOUT_MS') ?? 30_000);
  }

  scan(file: Buffer): Promise<ScanVerdict> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      const fail = (err: unknown) => {
        socket.destroy();
        this.logger.error(
          `ClamAV unavailable: ${err instanceof Error ? err.message : String(err)}`,
        );
        reject(
          new ServiceUnavailableException({
            code: 'SCAN_UNAVAILABLE',
            message: 'Antivirus scanning is unavailable. Try again later.',
          }),
        );
      };
      socket.setTimeout(this.timeoutMs, () => fail(new Error('timeout')));
      socket.on('error', fail);
      socket.on('data', (d) => chunks.push(d));
      socket.on('end', () => resolve(parseClamdReply(Buffer.concat(chunks).toString('utf8'))));
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const CHUNK = 64 * 1024;
        for (let i = 0; i < file.length; i += CHUNK) {
          const part = file.subarray(i, i + CHUNK);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.length);
          socket.write(len);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4)); // end of stream
      });
    });
  }
}

export function parseClamdReply(reply: string): ScanVerdict {
  const text = reply.replace(/\0/g, '').trim();
  if (/: OK$/.test(text)) return { status: 'CLEAN' };
  const found = /: (.+) FOUND$/.exec(text);
  if (found) return { status: 'INFECTED', signature: found[1]! };
  throw new ServiceUnavailableException({
    code: 'SCAN_UNAVAILABLE',
    message: `Unexpected antivirus reply: ${text.slice(0, 120)}`,
  });
}
