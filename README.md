# FixedLine

An SMS scheduling assistant for small HVAC businesses: customers text a business number, the assistant collects the job details, books a slot on the owner's Google Calendar, and texts both sides a confirmation.

## The problem

Small trade businesses lose jobs when calls and texts arrive while the owner is on a site. A missed call often means the customer books a competitor. Hiring office staff to answer every message is expensive for a one or two person shop.

## What it does

* Gives each business a dedicated Twilio number that answers inbound texts.
* Sends a text back automatically after a missed call.
* Collects the customer's issue, address, urgency, and preferred time, quoting only the price ranges the owner configured.
* Creates the appointment in Postgres and on Google Calendar, then texts the customer and the owner.
* Lets the owner pause the assistant, read every thread, and take over a conversation by hand.
* Handles a 14 day trial and a monthly subscription through Stripe.

## How it works

```
Customer SMS -> Twilio webhook -> Express API (TypeScript)
   signature check, idempotency, rate limit, business lookup
   -> language model with a book_appointment tool
   -> Supabase Postgres (conversations, appointments)
   -> Google Calendar event, Twilio replies
Owner dashboard: Next.js + Tailwind, Supabase Auth
```

Design choices worth noting:

* The webhook returns an empty TwiML response at once and replies through the Twilio REST API, so slow model calls never time out Twilio.
* A `webhook_events` table keyed on the Twilio MessageSid makes retries idempotent.
* Booking is detected through a structured tool call, not by parsing free text.
* Google OAuth tokens and the OAuth `state` value are encrypted with AES-256-GCM, so the state cannot be forged to attach a calendar to another business.
* Row level security policies restrict each owner to their own business data.
* The assistant identifies itself as automated if a customer asks.

The language model call lives in `backend/src/services/ai.service.ts` and uses the OpenAI Chat Completions API.

## Quickstart

Requirements: Node.js 20+, and accounts for Supabase, Twilio, OpenAI, Google Cloud (Calendar API), and Stripe.

1. In the Supabase SQL editor, run `backend/src/db/schema.sql` and then `backend/src/db/migrations/001_rpc_append_message.sql`.
2. Start the backend:
   ```bash
   cd backend
   cp .env.example .env   # fill in values
   npm install
   npm run dev            # or: npm run build && npm start
   ```
3. Start the frontend:
   ```bash
   cd frontend
   cp .env.example .env.local
   npm install
   npm run dev            # http://localhost:3000
   ```
4. For Twilio and Stripe webhooks to reach a local backend, expose port 3001 with a tunnel and set `BACKEND_URL` to the public URL.

The repo includes `backend/railway.json` and `frontend/vercel.json` for deploying to Railway and Vercel.

## Configuration

All secrets are read from environment variables. Never commit `.env` files; both are ignored by git.

| Variable | Purpose |
|---|---|
| `FRONTEND_URL` | Allowed frontend origin(s), comma separated |
| `BACKEND_URL` | Public backend URL used for Twilio webhooks |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | Database and auth |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | SMS and number provisioning |
| `OPENAI_API_KEY` | Language model calls |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Calendar OAuth; redirect is `<BACKEND_URL>/api/businesses/calendar/callback` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO_PRICE_ID` | Billing |
| `ENCRYPTION_KEY` | 64 hex characters, from `openssl rand -hex 32` |

Frontend: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`.

Stripe webhook endpoint: `<BACKEND_URL>/webhook/stripe`, subscribed to `customer.subscription.*`, `invoice.payment_failed`, and `invoice.payment_succeeded`.

## Limitations and next steps

* This is a prototype. It has not been run with paying customers and has no automated test suite yet.
* Offered times come from configured working hours. A `getAvailableSlots` calendar helper exists but is not yet wired into the conversation, so double booking is possible.
* Model output can be wrong, so the owner should review bookings, and the dashboard keeps a human takeover option for that reason.
* US phone numbers only (`+1` format).
* SMS consent and carrier registration (A2P 10DLC) must be handled before any real deployment.
* Next steps: unit tests for the webhook flow, availability checks against the calendar, and an audit log of owner actions.

## License

MIT. See [LICENSE](LICENSE).
