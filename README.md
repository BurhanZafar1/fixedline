# FixedLine — AI SMS Scheduling for HVAC Businesses

FixedLine is a production-ready SaaS that gives HVAC businesses an AI-powered SMS scheduling assistant. Customers text in, the AI qualifies their job and books an appointment, Google Calendar gets updated, and the owner gets notified — all automatically.

---

## Architecture

```
Customer SMS
    │
    ▼
Twilio (webhook)
    │
    ▼
Railway (Express + TypeScript)
    ├── validateTwilioSignature   ← security
    ├── idempotency check         ← dedup Twilio retries
    ├── business lookup by number
    ├── GPT-4o (function calling) ← AI response
    ├── book_appointment() fn     ← booking detection
    ├── Supabase (Postgres)       ← conversation/appt storage
    ├── Google Calendar           ← event creation
    └── Twilio REST               ← send reply + owner notify
    
Vercel (Next.js + Tailwind)
    ├── /login
    ├── /onboarding  (4 steps)
    ├── /dashboard   (today's jobs, AI toggle)
    ├── /conversations  (list + takeover)
    └── /settings    (services, hours, billing)
```

**Key design decisions:**
- Webhook returns `<Response/>` immediately — no Twilio timeout risk. AI processes async via REST API.
- Google OAuth tokens encrypted with AES-256-GCM before storing in Postgres.
- `webhook_events` table with Twilio MessageSid as PK = idempotency without extra infrastructure.
- Supabase RLS policies enforce tenant isolation — businesses can never see each other's data.
- OpenAI function calling detects booking confirmation — no fragile regex parsing.

---

## Setup

### Prerequisites
- Node.js 20+
- Supabase project
- Twilio account
- OpenAI API key
- Google Cloud project with Calendar API enabled
- Stripe account
- Railway account
- Vercel account

---

### Step 1: Supabase

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run:
   - `backend/src/db/schema.sql`
   - `backend/src/db/migrations/001_rpc_append_message.sql`
3. Copy your project URL and **service role** key (Settings → API)

---

### Step 2: Google Calendar OAuth

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → Enable "Google Calendar API"
3. Credentials → Create OAuth 2.0 Client ID (Web application)
4. Add Authorized redirect URI: `https://your-railway-app.railway.app/api/businesses/calendar/callback`
5. Copy Client ID and Client Secret

---

### Step 3: Twilio

1. Create a Twilio account at [twilio.com](https://twilio.com)
2. Copy Account SID and Auth Token
3. You don't need to buy a number manually — FixedLine provisions numbers via API during onboarding

---

### Step 4: Stripe

1. Create a Stripe account
2. Create a Product: "Solo Plan" with a recurring price of $79/month
3. Copy the Price ID (`price_xxx`)
4. Copy Secret Key
5. Set up webhook endpoint pointing to `https://your-backend/webhook/stripe`
6. Subscribe to: `customer.subscription.*`, `invoice.payment_failed`, `invoice.payment_succeeded`

---

### Step 5: Backend (Railway)

```bash
cd backend
cp .env.example .env
# Fill in all values

npm install
npm run dev  # local development

# Generate your ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Deploy to Railway:**
```bash
railway login
railway init
railway up
```

Set all environment variables in Railway dashboard under Variables.

After deployment, copy your Railway app URL (e.g., `https://fixedline-backend.railway.app`).

---

### Step 6: Frontend (Vercel)

```bash
cd frontend
cp .env.example .env.local
# Fill in:
# NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
# NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
# NEXT_PUBLIC_API_URL=https://your-railway-app.railway.app

npm install
npm run dev  # local development
```

**Deploy to Vercel:**
```bash
vercel login
vercel
```

Set environment variables in Vercel dashboard.

---

### Step 7: Update Twilio webhook URL

After deployment, go to Twilio Console → Phone Numbers → Active Numbers → select your provisioned number → set:
- SMS webhook: `https://your-railway-app.railway.app/webhook/sms` (POST)
- Voice webhook: `https://your-railway-app.railway.app/webhook/voice` (POST)

(This is done automatically when a number is provisioned via the API — this step is only needed if you're adding an existing number.)

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description |
|---|---|
| `PORT` | Server port (default 3001) |
| `NODE_ENV` | `production` or `development` |
| `FRONTEND_URL` | Your Vercel URL |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (never expose to browser) |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `OPENAI_API_KEY` | OpenAI API key |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Must match what's set in Google Console |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_SOLO_PRICE_ID` | Stripe price ID for $79/month plan |
| `ENCRYPTION_KEY` | 64-char hex string for AES-256 token encryption |

### Frontend (`frontend/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (safe for browser) |
| `NEXT_PUBLIC_API_URL` | Your Railway backend URL |

---

## Core Product Loop

1. Customer texts the HVAC business's Twilio number
2. Webhook fires → signature validated → idempotency checked
3. Business found by Twilio number → AI enabled check
4. GPT-4o generates response using conversation history + business context
5. If AI calls `book_appointment()` function:
   - Appointment created in Supabase
   - Google Calendar event created
   - Confirmation SMS sent to customer
   - Owner notified via SMS
6. Response sent to customer via Twilio REST API

---

## AI Behavior

The AI:
- Never says it's a bot (says "scheduling assistant for [Business]" if asked)
- Keeps all messages to 1–2 sentences
- Never gives exact prices — only ranges from your service config
- Always pushes toward booking a time slot
- Detects urgency and prioritizes fast scheduling
- Calls `book_appointment()` only when it has: name, address, service type, and confirmed time

---

## Security

- Twilio webhook validated via HMAC-SHA1 signature
- Google tokens encrypted with AES-256-GCM at rest
- Supabase RLS policies prevent cross-tenant data access
- Helmet.js sets security headers
- Rate limiting: 100 req/15min on API, 10 req/15min on auth, 10 SMS/min per phone
- All env vars validated at startup (fail fast)
- CORS restricted to known origins

---

## TCPA Compliance Notes

- Twilio automatically handles STOP/START/HELP opt-out keywords — we skip AI processing for these
- Never send unsolicited marketing messages
- All conversations are customer-initiated (inbound)
- Include STOP instructions in confirmation messages
- Consult legal counsel for full TCPA compliance in your jurisdiction

---

## Pricing

| Plan | Price | Features |
|---|---|---|
| Solo | $79/month | 1 business, unlimited SMS, AI scheduling, Google Calendar |

14-day free trial, no credit card required.

---

## File Structure

```
fixedline/
├── backend/
│   ├── src/
│   │   ├── types/index.ts          ← All TypeScript interfaces
│   │   ├── db/
│   │   │   ├── schema.sql          ← Run in Supabase SQL Editor
│   │   │   ├── supabase.ts         ← Service-role client + typed helpers
│   │   │   └── migrations/         ← RPC functions
│   │   ├── utils/
│   │   │   ├── logger.ts           ← Winston logger
│   │   │   └── crypto.ts           ← AES-256 encrypt/decrypt
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts  ← JWT verification
│   │   │   ├── rateLimiter.ts      ← Express rate limiting
│   │   │   └── twilioValidate.ts   ← Twilio HMAC signature check
│   │   ├── services/
│   │   │   ├── ai.service.ts       ← GPT-4o + function calling
│   │   │   ├── twilio.service.ts   ← SMS send + number provisioning
│   │   │   ├── calendar.service.ts ← Google Calendar OAuth + events
│   │   │   └── stripe.service.ts   ← Subscriptions + webhooks
│   │   ├── routes/
│   │   │   ├── webhook.ts          ← /webhook/sms + /voice + /stripe
│   │   │   ├── businesses.ts       ← Business CRUD + OAuth + billing
│   │   │   ├── conversations.ts    ← Conversations + takeover + reply
│   │   │   ├── appointments.ts     ← Appointment CRUD
│   │   │   └── auth.ts             ← Signup
│   │   └── server.ts               ← Express app + startup validation
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   └── railway.json
│
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── supabase.ts         ← Browser Supabase client
│   │   │   └── api.ts              ← All API calls + TypeScript types
│   │   ├── components/
│   │   │   ├── Layout.tsx          ← Shell with sidebar
│   │   │   ├── Sidebar.tsx         ← Navigation
│   │   │   ├── ConversationView.tsx ← Chat thread UI
│   │   │   └── AppointmentCard.tsx ← Appointment display
│   │   ├── pages/
│   │   │   ├── index.tsx           ← Redirect to login/dashboard
│   │   │   ├── login.tsx           ← Login + signup
│   │   │   ├── dashboard.tsx       ← Today's jobs + AI toggle
│   │   │   ├── conversations.tsx   ← Conversation list
│   │   │   ├── conversations/[id].tsx ← Thread detail + takeover
│   │   │   ├── settings.tsx        ← Business settings
│   │   │   └── onboarding.tsx      ← 5-step setup wizard
│   │   └── styles/globals.css
│   ├── .env.example
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.ts
│   └── vercel.json
│
└── README.md
```
