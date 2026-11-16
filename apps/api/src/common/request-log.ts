import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');
const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * One log line per request: method, route path, status, duration and a request id that is
 * echoed back in X-Request-Id (taken from the reverse proxy when it sent a well-formed one).
 * Query strings, bodies, cookies and headers are never logged: they can carry tokens or
 * personal data. Health probes are skipped to keep the log readable.
 */
export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  const path = req.originalUrl.split('?')[0] ?? '';
  if (path.includes('/health')) return next();

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const line = {
      requestId: id,
      method: req.method,
      path,
      status: res.statusCode,
      ms: Math.round(ms),
    };
    if (res.statusCode >= 500) logger.error(line);
    else if (res.statusCode >= 400) logger.warn(line);
    else logger.log(line);
  });
  next();
}
