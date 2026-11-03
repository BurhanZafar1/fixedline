import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import type {
  Business,
  ConversationMessage,
  BookingDetails,
  WorkingHours,
} from '../types';
import logger from '../utils/logger';

const openai = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'],
  timeout: 20_000, // 20s hard timeout
  maxRetries: 2,
});

// ──────────────────────────────────────────────────────────────
// System prompt generation
// ──────────────────────────────────────────────────────────────

function formatWorkingHours(wh: WorkingHours): string {
  const days = [
    'monday', 'tuesday', 'wednesday', 'thursday',
    'friday', 'saturday', 'sunday',
  ] as const;

  return days
    .filter(d => wh[d].enabled)
    .map(d => `${d.charAt(0).toUpperCase() + d.slice(1)}: ${wh[d].start}–${wh[d].end}`)
    .join(', ');
}

function buildSystemPrompt(business: Business, currentLocalTime: string): string {
  const serviceList = business.services
    .map(s => `• ${s.name}: typically $${s.price_min}–$${s.price_max}`)
    .join('\n');

  const hours = formatWorkingHours(business.working_hours);

  return `You are the friendly scheduling assistant for ${business.name}, a local HVAC company. You help customers book service appointments via text message.

IDENTITY RULES:
- You are an automated scheduling assistant for ${business.name}
- If asked whether you are a bot or AI, say honestly that you are ${business.name}'s automated scheduling assistant and that the owner can follow up personally if they prefer
- Never claim to be a human

MESSAGING RULES (CRITICAL):
- Maximum 1–2 sentences per reply — customers are on mobile phones
- Sound warm and local, like a friendly office assistant
- Never use bullet points, lists, or formal language
- Use contractions (it's, we've, I'll)
- If someone is rude, stay calm and professional

CONVERSATION FLOW:
1. Greet warmly and ask what HVAC issue they're having
2. Ask for their address (to confirm you cover the area)
3. Gauge urgency — is it an emergency or can it wait?
4. Offer 2 specific time options (e.g., "tomorrow morning around 9–11am or Wednesday afternoon?")
5. When they pick a time, ask for their name to finalize the booking
6. Confirm the appointment: name, service, time, rough price range
7. Always end the booking with: "A technician will confirm the exact pricing when they arrive — see you then!"

PRICING RULES:
- Never give exact quotes — only ranges
- Always say pricing depends on the specific issue
${serviceList ? `\nSERVICES & TYPICAL RANGES:\n${serviceList}` : ''}

URGENCY HANDLING:
- If it sounds like an emergency (gas smell, no heat in winter, no AC in extreme heat, flooding), say: "That sounds urgent — let me get someone out to you ASAP. What's your address?"
- Prioritize next available slot for emergencies

BUSINESS HOURS: ${hours}
Current local time: ${currentLocalTime}

BOOKING COMPLETION:
When you have all of: customer name, address, service type, and specific appointment time — call the book_appointment function to finalize the booking. Do NOT ask for more info than needed.`;
}

// ──────────────────────────────────────────────────────────────
// OpenAI function definitions for booking detection
// ──────────────────────────────────────────────────────────────

const bookingFunction: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'book_appointment',
    description: 'Finalize and book an appointment when you have all required customer details: name, address, service type, and confirmed time slot.',
    parameters: {
      type: 'object',
      properties: {
        customer_name: {
          type: 'string',
          description: 'Customer\'s full name',
        },
        service_type: {
          type: 'string',
          description: 'Type of HVAC service needed (e.g., "AC not cooling", "furnace repair", "annual maintenance")',
        },
        address: {
          type: 'string',
          description: 'Customer\'s service address',
        },
        scheduled_time_iso: {
          type: 'string',
          description: 'Appointment start time in ISO 8601 format (e.g., 2024-07-15T09:00:00)',
        },
        duration_minutes: {
          type: 'number',
          description: 'Expected job duration in minutes. Default 120 for most HVAC jobs.',
          default: 120,
        },
        price_range: {
          type: 'string',
          description: 'Rough price range mentioned to customer (e.g., "$150–$350")',
        },
        notes: {
          type: 'string',
          description: 'Any additional details about the issue or special instructions',
        },
      },
      required: ['customer_name', 'service_type', 'address', 'scheduled_time_iso'],
    },
  },
};

// ──────────────────────────────────────────────────────────────
// Main AI response function
// ──────────────────────────────────────────────────────────────

export interface AIResponse {
  message: string;
  bookingDetails: BookingDetails | null;
  confirmationMessage: string | null; // the final message to send after booking
}

const FALLBACK_MESSAGE =
  "Thanks for reaching out! I'm having a little trouble on my end — can you text back in a moment and I'll get you sorted right away.";

export async function generateResponse(
  business: Business,
  conversationHistory: ConversationMessage[],
  incomingMessage: string
): Promise<AIResponse> {
  // Only use last 10 messages for context (token efficiency + relevance)
  const recentHistory = conversationHistory.slice(-10);

  const localTime = new Date().toLocaleString('en-US', {
    timeZone: business.timezone || 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const systemPrompt = buildSystemPrompt(business, localTime);

  // Convert conversation history to OpenAI format
  const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = recentHistory.map(msg => ({
    role: msg.role === 'customer' ? 'user' : 'assistant',
    content: msg.content,
  }));

  // Add the new incoming message
  openAiMessages.push({ role: 'user', content: incomingMessage });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, ...openAiMessages],
      tools: [bookingFunction],
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 300, // keep replies short
    });

    const choice = completion.choices[0];
    if (!choice) {
      logger.warn('OpenAI returned no choices');
      return { message: FALLBACK_MESSAGE, bookingDetails: null, confirmationMessage: null };
    }

    const assistantMessage = choice.message;

    // Check if the model wants to call book_appointment
    if (
      choice.finish_reason === 'tool_calls' &&
      assistantMessage.tool_calls?.length
    ) {
      const toolCall = assistantMessage.tool_calls[0];
      if (toolCall?.function.name === 'book_appointment') {
        let details: BookingDetails;
        try {
          details = JSON.parse(toolCall.function.arguments) as BookingDetails;
        } catch {
          logger.error('Failed to parse booking function args', {
            args: toolCall.function.arguments,
          });
          return { message: FALLBACK_MESSAGE, bookingDetails: null, confirmationMessage: null };
        }

        // Generate a natural confirmation message
        const confirmationCompletion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            ...openAiMessages,
            { role: 'assistant', content: null, tool_calls: assistantMessage.tool_calls },
            {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'Appointment booked successfully.',
            },
          ],
          temperature: 0.7,
          max_tokens: 200,
        });

        const confirmMsg =
          confirmationCompletion.choices[0]?.message?.content ??
          `Perfect, ${details.customer_name}! You're all set for ${new Date(details.scheduled_time_iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. A technician will confirm the exact pricing when they arrive — see you then!`;

        return {
          message: confirmMsg,
          bookingDetails: details,
          confirmationMessage: confirmMsg,
        };
      }
    }

    // Normal response (no booking yet)
    const responseText = assistantMessage.content;
    if (!responseText) {
      return { message: FALLBACK_MESSAGE, bookingDetails: null, confirmationMessage: null };
    }

    return { message: responseText, bookingDetails: null, confirmationMessage: null };
  } catch (err) {
    logger.error('OpenAI API error', { err });

    // Check if it's a timeout
    if (err instanceof Error && err.message.includes('timeout')) {
      return {
        message: "Sorry, we're a bit backed up right now — I'll text you right back in just a minute!",
        bookingDetails: null,
        confirmationMessage: null,
      };
    }

    return { message: FALLBACK_MESSAGE, bookingDetails: null, confirmationMessage: null };
  }
}

// ──────────────────────────────────────────────────────────────
// Helper: detect if a message is spam/nonsense (avoid AI processing)
// ──────────────────────────────────────────────────────────────

export function isSpamMessage(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length > 1000) return true; // unreasonably long

  // Common SMS spam/bot patterns
  const spamPatterns = [
    /^(STOP|UNSUBSCRIBE|CANCEL|END|QUIT)$/i,
    /^(HELP|INFO|START)$/i, // opt-in/out keywords — handle separately
    /http[s]?:\/\//i,       // links in messages
    /\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}/, // credit card patterns
  ];

  // STOP/START/HELP are Twilio opt-out keywords — let Twilio handle them
  if (/^(STOP|UNSUBSCRIBE|CANCEL|END|QUIT|HELP|START|YES)$/i.test(trimmed)) {
    return true;
  }

  return spamPatterns.slice(2).some(p => p.test(trimmed));
}

export function buildMessageId(): string {
  return uuidv4();
}
