import { google, calendar_v3 } from 'googleapis';
import type { Business, WorkingHours, TimeSlot } from '../types';
import { decrypt, encrypt } from '../utils/crypto';
import { updateBusiness } from '../db/supabase';
import logger from '../utils/logger';

const oauth2Client = new google.auth.OAuth2(
  process.env['GOOGLE_CLIENT_ID'],
  process.env['GOOGLE_CLIENT_SECRET'],
  process.env['GOOGLE_REDIRECT_URI']
);

// ──────────────────────────────────────────────────────────────
// OAuth helpers
// ──────────────────────────────────────────────────────────────

const OAUTH_STATE_MAX_AGE_MS = 15 * 60 * 1000;

// The OAuth state is encrypted with AES-256-GCM, so it cannot be forged or
// altered: a caller cannot attach their Google tokens to another business.
export function createOAuthState(businessId: string): string {
  return encrypt(JSON.stringify({ b: businessId, t: Date.now() }));
}

export function parseOAuthState(state: string): string | null {
  try {
    const { b, t } = JSON.parse(decrypt(state)) as { b?: string; t?: number };
    if (!b || typeof t !== 'number') return null;
    if (Date.now() - t > OAUTH_STATE_MAX_AGE_MS) return null;
    return b;
  } catch {
    return null;
  }
}

export function getAuthUrl(businessId: string): string {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // always get refresh_token
    scope: ['https://www.googleapis.com/auth/calendar'],
    state: createOAuthState(businessId),
  });
}

export async function exchangeCodeForTokens(
  code: string
): Promise<{ access_token: string; refresh_token: string; expiry_date: number }> {
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Google OAuth did not return required tokens');
  }
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date ?? Date.now() + 3600 * 1000,
  };
}

// ──────────────────────────────────────────────────────────────
// Get authenticated calendar client for a business
// ──────────────────────────────────────────────────────────────

async function getCalendarClient(business: Business): Promise<calendar_v3.Calendar> {
  if (!business.google_calendar_token_encrypted) {
    throw new Error('Business has not connected Google Calendar');
  }

  const tokenJson = decrypt(business.google_calendar_token_encrypted);
  const tokens = JSON.parse(tokenJson) as {
    access_token: string;
    refresh_token: string;
    expiry_date: number;
  };

  const auth = new google.auth.OAuth2(
    process.env['GOOGLE_CLIENT_ID'],
    process.env['GOOGLE_CLIENT_SECRET'],
    process.env['GOOGLE_REDIRECT_URI']
  );

  auth.setCredentials(tokens);

  // Auto-refresh and persist new tokens
  auth.on('tokens', async (newTokens) => {
    try {
      const updated = { ...tokens, ...newTokens };
      await updateBusiness(business.id, {
        google_calendar_token_encrypted: encrypt(JSON.stringify(updated)),
      });
    } catch (err) {
      logger.error('Failed to persist refreshed Google tokens', { businessId: business.id, err });
    }
  });

  return google.calendar({ version: 'v3', auth });
}

// ──────────────────────────────────────────────────────────────
// Get available time slots
// ──────────────────────────────────────────────────────────────

export async function getAvailableSlots(
  business: Business,
  daysAhead = 3
): Promise<TimeSlot[]> {
  const tz = business.timezone || 'America/New_York';
  const workingHours = business.working_hours;

  // Build candidate slots for the next `daysAhead` working days
  const candidateSlots: TimeSlot[] = [];
  const now = new Date();

  for (let dayOffset = 0; dayOffset <= daysAhead + 2; dayOffset++) {
    if (candidateSlots.length >= 6) break; // enough options

    const date = new Date(now);
    date.setDate(date.getDate() + dayOffset);

    const dayName = date
      .toLocaleDateString('en-US', { weekday: 'long', timeZone: tz })
      .toLowerCase() as keyof WorkingHours;

    const dayConfig = workingHours[dayName];
    if (!dayConfig?.enabled) continue;

    const [startHour, startMin] = dayConfig.start.split(':').map(Number) as [number, number];
    const [endHour] = dayConfig.end.split(':').map(Number) as [number];

    // Generate 2-hour slots throughout the day
    for (let hour = startHour; hour + 2 <= endHour; hour += 2) {
      const slotStart = new Date(date);
      slotStart.setHours(hour, startMin || 0, 0, 0);

      // Don't offer slots less than 2 hours from now
      if (slotStart.getTime() < now.getTime() + 2 * 60 * 60 * 1000) continue;

      const slotEnd = new Date(slotStart);
      slotEnd.setHours(slotStart.getHours() + 2);

      const label = slotStart.toLocaleString('en-US', {
        timeZone: tz,
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        hour12: true,
      });

      candidateSlots.push({ start: slotStart, end: slotEnd, label });
    }
  }

  // Filter out slots that conflict with existing calendar events
  if (business.google_calendar_token_encrypted && candidateSlots.length > 0) {
    try {
      const calendar = await getCalendarClient(business);
      const calendarId = business.google_calendar_id || 'primary';

      const timeMin = candidateSlots[0]!.start.toISOString();
      const timeMax = candidateSlots[candidateSlots.length - 1]!.end.toISOString();

      const events = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const busyPeriods = (events.data.items ?? []).map(e => ({
        start: new Date(e.start?.dateTime ?? e.start?.date ?? ''),
        end: new Date(e.end?.dateTime ?? e.end?.date ?? ''),
      }));

      return candidateSlots.filter(slot =>
        !busyPeriods.some(
          busy => slot.start < busy.end && slot.end > busy.start
        )
      );
    } catch (err) {
      logger.warn('Could not fetch calendar events for conflict check', { err });
      // Return unfiltered slots rather than blocking booking entirely
    }
  }

  return candidateSlots;
}

// ──────────────────────────────────────────────────────────────
// Create a calendar event
// ──────────────────────────────────────────────────────────────

export async function createCalendarEvent(
  business: Business,
  customerName: string,
  customerPhone: string,
  serviceType: string,
  address: string,
  startTime: Date,
  endTime: Date,
  notes?: string
): Promise<string | null> {
  try {
    const calendar = await getCalendarClient(business);
    const calendarId = business.google_calendar_id || 'primary';
    const tz = business.timezone || 'America/New_York';

    const event = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `${serviceType} — ${customerName}`,
        description: [
          `Customer: ${customerName}`,
          `Phone: ${customerPhone}`,
          `Service: ${serviceType}`,
          `Address: ${address}`,
          notes ? `Notes: ${notes}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        location: address,
        start: { dateTime: startTime.toISOString(), timeZone: tz },
        end: { dateTime: endTime.toISOString(), timeZone: tz },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 60 },
            { method: 'email', minutes: 60 },
          ],
        },
        colorId: '2', // green — easy to spot
      },
    });

    logger.info('Calendar event created', { eventId: event.data.id, businessId: business.id });
    return event.data.id ?? null;
  } catch (err) {
    logger.error('Failed to create calendar event', { businessId: business.id, err });
    return null; // Non-fatal — booking still succeeds without the calendar event
  }
}

// ──────────────────────────────────────────────────────────────
// Disconnect calendar (used in settings)
// ──────────────────────────────────────────────────────────────

export async function disconnectCalendar(business: Business): Promise<void> {
  if (!business.google_calendar_token_encrypted) return;
  try {
    const tokenJson = decrypt(business.google_calendar_token_encrypted);
    const tokens = JSON.parse(tokenJson) as { access_token: string };
    await oauth2Client.revokeToken(tokens.access_token);
  } catch {
    // Best effort revoke — don't fail if already expired
  }
  await updateBusiness(business.id, {
    google_calendar_token_encrypted: null,
    google_calendar_id: null,
  });
}
