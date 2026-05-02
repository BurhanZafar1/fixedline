import { Router, Request, Response } from 'express';
import twiml from 'twilio/lib/twiml/MessagingResponse';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';
import { v4 as uuidv4 } from 'uuid';
import { validateTwilioSignature } from '../middleware/twilioValidate';
import { smsLimiter } from '../middleware/rateLimiter';
import {
  getBusinessByTwilioNumber,
  getOrCreateConversation,
  appendMessage,
  updateConversation,
  createAppointment,
  checkAndMarkWebhookEvent,
} from '../db/supabase';
import {
  generateResponse,
  isSpamMessage,
  buildMessageId,
} from '../services/ai.service';
import {
  sendSms,
  sendAppointmentConfirmation,
  notifyOwnerOfBooking,
  sendMissedCallReply,
} from '../services/twilio.service';
import { createCalendarEvent } from '../services/calendar.service';
import type { TwilioSmsWebhookBody, TwilioVoiceWebhookBody } from '../types';
import logger from '../utils/logger';

const router = Router();

// ──────────────────────────────────────────────────────────────
// POST /webhook/sms  — inbound SMS from customers
// ──────────────────────────────────────────────────────────────
router.post(
  '/sms',
  validateTwilioSignature,
  smsLimiter,
  async (req: Request, res: Response): Promise<void> => {
    // Respond to Twilio immediately with an empty TwiML so the request
    // doesn't time out while we do async AI processing.
    const emptyTwiml = new twiml();
    res.type('text/xml').status(200).send(emptyTwiml.toString());

    // All processing happens after the response is sent
    const body = req.body as TwilioSmsWebhookBody;
    const { MessageSid, From: customerPhone, To: twilioNumber, Body: messageBody } = body;

    if (!MessageSid || !customerPhone || !twilioNumber || !messageBody) {
      logger.warn('Incomplete SMS webhook body', { body });
      return;
    }

    try {
      // ── 1. Idempotency check ───────────────────────────────
      const isDuplicate = await checkAndMarkWebhookEvent(MessageSid, 'sms');
      if (isDuplicate) {
        logger.info('Duplicate SMS webhook ignored', { MessageSid });
        return;
      }

      // ── 2. Resolve business by Twilio number ──────────────
      const business = await getBusinessByTwilioNumber(twilioNumber);
      if (!business) {
        logger.warn('No business found for Twilio number', { twilioNumber });
        return;
      }

      // ── 3. Check subscription status ─────────────────────
      const activeStatuses = ['trial', 'active'];
      if (!activeStatuses.includes(business.subscription_status)) {
        logger.info('AI paused — subscription not active', {
          businessId: business.id,
          status: business.subscription_status,
        });
        return;
      }

      // ── 4. Check AI toggle ────────────────────────────────
      if (!business.ai_enabled) {
        logger.info('AI disabled for business', { businessId: business.id });
        return;
      }

      // ── 5. Spam/opt-out filter ────────────────────────────
      if (isSpamMessage(messageBody)) {
        logger.info('Spam/opt-out message, skipping AI', { customerPhone, messageBody });
        return;
      }

      // ── 6. Get or create conversation ─────────────────────
      const conversation = await getOrCreateConversation(business.id, customerPhone);

      // Don't respond to human-taken-over conversations
      if (conversation.status === 'human_takeover') {
        logger.info('Conversation in human_takeover, skipping AI', {
          conversationId: conversation.id,
        });
        return;
      }

      // ── 7. Store the incoming message ─────────────────────
      const incomingMsg = {
        id: buildMessageId(),
        role: 'customer' as const,
        content: messageBody.trim(),
        timestamp: new Date().toISOString(),
      };
      await appendMessage(conversation.id, incomingMsg);

      // ── 8. Generate AI response ───────────────────────────
      const aiResult = await generateResponse(
        business,
        [...conversation.messages, incomingMsg],
        messageBody.trim()
      );

      // ── 9. Store the AI response ──────────────────────────
      const outgoingMsg = {
        id: buildMessageId(),
        role: 'assistant' as const,
        content: aiResult.message,
        timestamp: new Date().toISOString(),
      };
      await appendMessage(conversation.id, outgoingMsg);

      // ── 10. Send the reply to the customer ────────────────
      await sendSms(customerPhone, twilioNumber, aiResult.message);

      // ── 11. If AI triggered a booking, create the appointment ─
      if (aiResult.bookingDetails) {
        const details = aiResult.bookingDetails;
        const scheduledTime = new Date(details.scheduled_time_iso);
        const endTime = new Date(
          scheduledTime.getTime() + (details.duration_minutes || 120) * 60 * 1000
        );

        // Create calendar event (non-blocking, failure is logged not thrown)
        const googleEventId = await createCalendarEvent(
          business,
          details.customer_name,
          customerPhone,
          details.service_type,
          details.address,
          scheduledTime,
          endTime,
          details.notes
        );

        // Persist appointment to DB
        const appointment = await createAppointment({
          business_id: business.id,
          conversation_id: conversation.id,
          customer_phone: customerPhone,
          customer_name: details.customer_name,
          service_type: details.service_type,
          address: details.address,
          scheduled_time: scheduledTime.toISOString(),
          end_time: endTime.toISOString(),
          google_event_id: googleEventId,
          confirmed: true,
          notes: details.notes ?? null,
          price_range: details.price_range ?? null,
        });

        // Mark conversation as booked
        await updateConversation(conversation.id, {
          status: 'booked',
          appointment_booked: true,
          customer_name: details.customer_name,
        });

        // Send structured confirmation SMS to customer
        await sendAppointmentConfirmation(
          customerPhone,
          twilioNumber,
          details.customer_name,
          business.name,
          details.service_type,
          scheduledTime,
          business.timezone
        );

        // Notify the business owner
        if (business.phone_number) {
          await notifyOwnerOfBooking(
            business.phone_number,
            twilioNumber,
            details.customer_name,
            customerPhone,
            details.service_type,
            details.address,
            scheduledTime,
            business.timezone
          );
        }

        logger.info('Appointment booked', {
          appointmentId: appointment.id,
          businessId: business.id,
          customerPhone,
        });
      }

      // ── 12. Update conversation customer name if extracted ─
      if (
        aiResult.bookingDetails?.customer_name &&
        !conversation.customer_name
      ) {
        await updateConversation(conversation.id, {
          customer_name: aiResult.bookingDetails.customer_name,
        });
      }

    } catch (err) {
      logger.error('SMS webhook processing error', { MessageSid, err });

      // Best-effort fallback message — do NOT re-throw (response already sent)
      try {
        if (twilioNumber && customerPhone) {
          await sendSms(
            customerPhone,
            twilioNumber,
            "Sorry for the delay — we'll be right with you! Please text again in a moment."
          );
        }
      } catch {
        // Swallow secondary error
      }
    }
  }
);

// ──────────────────────────────────────────────────────────────
// POST /webhook/voice  — missed call handler
// ──────────────────────────────────────────────────────────────
router.post(
  '/voice',
  validateTwilioSignature,
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as TwilioVoiceWebhookBody;
    const { CallSid, From: callerPhone, To: twilioNumber, CallStatus } = body;

    // Respond immediately with TwiML (play voicemail greeting or just hang up)
    const voiceTwiml = new VoiceResponse();
    voiceTwiml.say(
      { voice: 'alice' },
      "Thanks for calling! I'm the scheduling assistant and I work best over text. " +
      "I'm sending you a text message right now so we can get you sorted quickly."
    );
    voiceTwiml.hangup();

    res.type('text/xml').status(200).send(voiceTwiml.toString());

    // Send the follow-up SMS asynchronously
    if (callerPhone && twilioNumber) {
      setImmediate(async () => {
        try {
          // Only send on missed/no-answer — not when they actually spoke to someone
          if (
            !CallStatus ||
            ['no-answer', 'busy', 'failed', 'completed'].includes(CallStatus.toLowerCase())
          ) {
            const isDuplicate = await checkAndMarkWebhookEvent(`voice_${CallSid}`, 'voice');
            if (isDuplicate) return;

            const business = await getBusinessByTwilioNumber(twilioNumber);
            if (!business?.ai_enabled) return;
            if (!['trial', 'active'].includes(business.subscription_status)) return;

            await sendMissedCallReply(callerPhone, twilioNumber, business.name);
            logger.info('Missed call SMS sent', { callerPhone, twilioNumber });
          }
        } catch (err) {
          logger.error('Failed to send missed call SMS', { CallSid, err });
        }
      });
    }
  }
);

// ──────────────────────────────────────────────────────────────
// POST /webhook/stripe  — Stripe billing events
// ──────────────────────────────────────────────────────────────
router.post(
  '/stripe',
  // Raw body required for Stripe signature verification
  // (must be mounted BEFORE express.json() parses this route)
  async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers['stripe-signature'] as string;
    if (!signature) {
      res.status(400).json({ error: 'Missing Stripe signature' });
      return;
    }

    try {
      const { handleStripeWebhook } = await import('../services/stripe.service');
      await handleStripeWebhook(req.body as Buffer, signature);
      res.json({ received: true });
    } catch (err) {
      logger.error('Stripe webhook error', { err });
      res.status(400).json({ error: (err as Error).message });
    }
  }
);

export default router;
