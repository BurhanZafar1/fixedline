import { Request, Response, NextFunction } from 'express';
import twilio from 'twilio';
import logger from '../utils/logger';

/**
 * Validates that inbound requests are genuinely from Twilio.
 * Uses X-Twilio-Signature header + HMAC-SHA1 of the full URL + sorted POST body.
 * Without this, anyone could POST to /webhook/sms and inject messages.
 */
export function validateTwilioSignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip validation in test environment
  if (process.env['NODE_ENV'] === 'test') {
    next();
    return;
  }

  const authToken = process.env['TWILIO_AUTH_TOKEN'];
  if (!authToken) {
    logger.error('TWILIO_AUTH_TOKEN not set');
    res.status(500).send('Server misconfiguration');
    return;
  }

  const signature = req.headers['x-twilio-signature'] as string | undefined;
  if (!signature) {
    logger.warn('Twilio webhook missing signature', { ip: req.ip });
    res.status(403).send('Forbidden');
    return;
  }

  // Reconstruct the full URL Twilio used (must match exactly)
  const protocol = req.headers['x-forwarded-proto'] ?? req.protocol;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const fullUrl = `${protocol}://${host}${req.originalUrl}`;

  const isValid = twilio.validateRequest(
    authToken,
    signature,
    fullUrl,
    req.body as Record<string, string>
  );

  if (!isValid) {
    logger.warn('Invalid Twilio signature', { url: fullUrl, ip: req.ip });
    res.status(403).send('Forbidden');
    return;
  }

  next();
}
