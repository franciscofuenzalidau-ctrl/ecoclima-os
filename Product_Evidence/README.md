# Product Evidence — EcoClima OS

Evidence that the AI agent runs continuously in production, collected from the live system.

**Collected:** 1 August 2026
**Live endpoints at time of collection:**
- API health: `https://ecoclima-backend-437714636966.southamerica-west1.run.app/health` → `{"status":"OK"}`
- Dashboard: `https://ecoclima-os-7ca1b.web.app`

---

## Gemini API usage (production)

Taken from the live `/api/ai-control/metrics` endpoint, which aggregates every Gemini call the
agent has made in production:

| Metric | Value |
|---|---|
| Total Gemini API calls | **27** |
| Total tokens consumed | **35,883** |
| Average latency | **1,727 ms** |
| Success rate | **96%** |
| Errors | 1 |

## Files in this folder

| File | What it is |
|---|---|
| `gemini_api_metrics.json` | Aggregate Gemini usage counters, exported live from the running system |
| `gemini_execution_logs.json` | Per-call execution log: timestamp, interaction type, tokens used, latency |
| `production_leads.json` | Lead records the agent created in Cloud Firestore |
| `health_check.txt` | Live health-check response from the Cloud Run service |

## What the logs demonstrate

The execution log shows the agent making real operational decisions on the company's production
WhatsApp line, not scripted demo traffic:

- **`location_received`** — the customer sent a WhatsApp GPS pin and the agent reverse-geocoded it
  into a dispatchable street address in Valdivia, Los Ríos, Chile, in 500 ms.
- **`text_message`** — multi-turn intake in Chilean Spanish: confirming equipment condition,
  collecting the service address, proposing concrete appointment slots, and confirming a booking.
- **Post-service survey** — the agent processed a customer satisfaction rating and replied
  appropriately.
- **Token and latency accounting** — every call is measured, typically 1,600–2,300 tokens and
  1.8–2.5 seconds end to end.

## Privacy notice

Customer telephone numbers have been replaced with `CUSTOMER_001`, `CUSTOMER_002`, `CUSTOMER_003`,
and street numbers and postal codes have been redacted, because this repository is public.

Street names, city and region are retained so judges can verify that the geocoding is real.

Unredacted records can be provided directly to the judging panel on request, with the affected
customers' consent, as permitted under the Hackathon rules.

## Still to be added

- [ ] Monthly Google Cloud billing invoice PDFs (Cloud Console → Billing → Invoices)
- [ ] Screenshots of the Gemini model observability dashboards
- [ ] Screenshot of the operations dashboard AI Control panel
