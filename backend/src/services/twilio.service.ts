import twilio from 'twilio';
import logger from '../utils/logger';

const accountSid = process.env['TWILIO_ACCOUNT_SID'] ?? '';
const authToken = process.env['TWILIO_AUTH_TOKEN'] ?? '';

// Lazy-initialize client to avoid crash at import time during tests
let _client: ReturnType<typeof twilio> | null = null;
function getClient() {
  if (!_client) {
    if (!accountSid || !authToken) {
      throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set');
    }
    _client = twilio(accountSid, authToken);
  }
  return _client;
}

// ──────────────────────────────────────────────────────────────
// Send SMS via Twilio REST API
// Used for async responses (after webhook has already returned 200)
// ──────────────────────────────────────────────────────────────

export async function sendSms(
  to: string,
  from: string,
  body: string
): Promise<string | null> {
  try {
    // Keep messages under 160 chars where possible; split naturally
    const truncated = body.length > 1600 ? body.slice(0, 1597) + '...' : body;

    const message = await getClient().messages.create({ to, from, body: truncated });
    logger.info('SMS sent', { to, messageSid: message.sid });
    return message.sid;
  } catch (err) {
    logger.error('Failed to send SMS', { to, err });
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// Send appointment confirmation to customer
// ──────────────────────────────────────────────────────────────

export async function sendAppointmentConfirmation(
  customerPhone: string,
  twilioNumber: string,
  customerName: string,
  businessName: string,
  serviceType: string,
  scheduledTime: Date,
  timezone: string
): Promise<void> {
  const formattedTime = scheduledTime.toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const body =
    `Hi ${customerName}! This is a confirmation from ${businessName} — ` +
    `you're scheduled for ${serviceType} on ${formattedTime}. ` +
    `We'll send a reminder the morning of. Reply STOP to cancel.`;

  await sendSms(customerPhone, twilioNumber, body);
}

// ──────────────────────────────────────────────────────────────
// Notify the business owner of a new booking
// ──────────────────────────────────────────────────────────────

export async function notifyOwnerOfBooking(
  ownerPhone: string,
  twilioNumber: string,
  customerName: string,
  customerPhone: string,
  serviceType: string,
  address: string,
  scheduledTime: Date,
  timezone: string
): Promise<void> {
  const formattedTime = scheduledTime.toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const body =
    `🔧 New job booked!\n` +
    `Customer: ${customerName} (${customerPhone})\n` +
    `Service: ${serviceType}\n` +
    `Address: ${address}\n` +
    `Time: ${formattedTime}`;

  await sendSms(ownerPhone, twilioNumber, body);
}

// ──────────────────────────────────────────────────────────────
// Missed-call auto-reply
// ──────────────────────────────────────────────────────────────

export async function sendMissedCallReply(
  callerPhone: string,
  twilioNumber: string,
  businessName: string
): Promise<void> {
  const body =
    `Hi! I noticed you just called ${businessName}. ` +
    `I'm the scheduling assistant — what can I help you with today?`;

  await sendSms(callerPhone, twilioNumber, body);
}

// ──────────────────────────────────────────────────────────────
// Provision a phone number for a new business (onboarding)
// ──────────────────────────────────────────────────────────────

export async function provisionPhoneNumber(
  areaCode: string,
  webhookBaseUrl: string
): Promise<string> {
  const client = getClient();

  // Search for an available local number in the requested area code
  const available = await client.availablePhoneNumbers('US').local.list({
    areaCode: parseInt(areaCode, 10),
    limit: 1,
    smsEnabled: true,
    voiceEnabled: true,
  });

  if (!available.length || !available[0]) {
    throw new Error(`No available phone numbers for area code ${areaCode}`);
  }

  const purchased = await client.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
    smsUrl: `${webhookBaseUrl}/webhook/sms`,
    smsMethod: 'POST',
    voiceUrl: `${webhookBaseUrl}/webhook/voice`,
    voiceMethod: 'POST',
  });

  logger.info('Phone number provisioned', { number: purchased.phoneNumber });
  return purchased.phoneNumber;
}
