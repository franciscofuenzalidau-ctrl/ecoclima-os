# EcoClima OS — AI Sales & Operations Agent for an HVAC Small Business

**Built with Gemini XPRIZE submission · Category: Small Business Services**

EcoClima OS is a WhatsApp AI agent that runs the customer-facing operation of **Furtz Clima**, a real
air-conditioning installation and maintenance business in Chile. It is not a demo: the agent answers the
company's production WhatsApp line, qualifies every lead, books appointments against a live calendar,
hands off to a human sales rep, and follows up after the job is done.

- 🤖 **Live WhatsApp number:** +56 9 5848 9307
- 📊 **Live operations dashboard:** https://ecoclima-os-7ca1b.web.app
- ⚙️ **Live API:** https://ecoclima-backend-437714636966.southamerica-west1.run.app/health

## What the AI actually decides

Gemini is not used for cosmetic text generation — it drives the operational decisions of the business:

| Decision | How Gemini handles it |
|---|---|
| **Service classification** | Reads the conversation and classifies the request as *Installation* or *Maintenance*, which determines the entire downstream workflow. |
| **Lead qualification** | Runs a strict one-question-at-a-time intake (business vs. individual, contact phone, number of units, payment method) and extracts structured data from free-form Spanish chat. |
| **Technical diagnosis (multimodal)** | Customers send photos of their AC units or electrical panels; Gemini analyses the image and writes the technical note the technician sees. |
| **Appointment booking** | Reads the live Firestore calendar of booked slots and proposes only free time windows (Mon–Sat, 09:00–18:00). |
| **Location handling** | Accepts WhatsApp GPS pins, reverse-geocodes them with Google Maps, and stores the service address. |
| **Human handoff** | Detects frustration or an explicit request for a human, alerts the sales executive over WhatsApp with the full lead context, and pauses itself for that customer. |
| **Post-service survey** | Runs a 4-question satisfaction survey (1–7 rating, expectations, referral likelihood, free comments) and asks for testimonial consent. |
| **Annual retention campaign** | One year after a job, sends a personalised preventive-maintenance offer based on the original service type and number of units. |

## Architecture

```
WhatsApp Cloud API (Meta)
        │  webhook
        ▼
Cloud Run — Node.js + Express + TypeScript   ← southamerica-west1 (Santiago)
        │
        ├── Gemini API (gemini-2.5-flash, text + vision)
        ├── Cloud Firestore  (leads, AI logs, metrics)
        └── Google Maps Geocoding API
        ▲
        │  /api/**  (Firebase Hosting rewrite)
Firebase Hosting — React + Vite dashboard
```

**Google Cloud products used:** Cloud Run, Cloud Firestore, Firebase Hosting, Cloud Build (CI/CD),
Cloud Logging, Google Maps Platform.

Every Gemini call is logged to Firestore with token count, latency and outcome, and surfaced in the
dashboard's AI Control panel — this is the production-AI evidence trail.

## Repository layout

```
ecoclima-backend/     Express API, WhatsApp webhook, Gemini service, Firestore access
  src/services/gemini.ts    Agent instructions, conversation state, lead extraction
  src/services/aiLogger.ts  Per-call AI logging and metrics
  src/routes/whatsapp.ts    Webhook: text, image and location messages
  src/routes/leads.ts       Lead CRUD, route optimisation, campaigns, surveys
  src/routes/aiControl.ts   AI logs and metrics endpoints
  src/routes/finances.ts    Revenue/cost tracking
ecoclima-dashboard/   React + Vite operations dashboard
ESTADO_PROYECTO.md    Operational runbook (Spanish)
```

## Running it locally

Requires Node.js 20+.

```bash
# Backend
cd ecoclima-backend
npm install
cp .env.example .env     # then fill in the values below
npm run dev              # http://localhost:3000

# Dashboard (separate terminal)
cd ecoclima-dashboard
npm install
npm run dev              # http://localhost:5173
```

Environment variables (`ecoclima-backend/.env`):

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini API key from Google AI Studio |
| `WHATSAPP_TOKEN` | WhatsApp Cloud API access token |
| `WHATSAPP_VERIFY_TOKEN` | Any string; must match the value set in Meta's webhook config |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID from the Meta app |
| `GOOGLE_MAPS_API_KEY` | Geocoding API key |
| `PORT` | Defaults to 3000 locally, 8080 in Cloud Run |

Firebase credentials are not needed locally if you run `gcloud auth application-default login`;
on Cloud Run the service account is provided automatically.

### Testing the agent without WhatsApp

```bash
npm run test:once     # single scripted message through the full Gemini pipeline
npm run test:chat     # interactive local chat with the agent
```

To exercise the real webhook, POST a WhatsApp-shaped payload to `/webhook`:

```bash
curl -X POST http://localhost:3000/webhook \
  -H 'Content-Type: application/json' \
  -d '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[{"from":"56900000001","type":"text","text":{"body":"Hola, necesito instalar un aire acondicionado"}}]}}]}]}'
```

Business rules (BTU sizing matrix, service costs, brands) live in
`ecoclima-backend/data_mock/config_reglas.json` and can also be edited from the dashboard.

## Deployment

Pushing to `main` triggers Cloud Build, which builds `ecoclima-backend/Dockerfile` and deploys a new
Cloud Run revision automatically. The dashboard is deployed with `firebase deploy --only hosting`.

## Language note

The agent converses in Chilean Spanish because its users are Chilean customers. Code, comments and this
document are in English. `ESTADO_PROYECTO.md` is the operational runbook kept in Spanish for the business owner.

## License

ISC
