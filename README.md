# GhostOps AI

**Autonomous Problem Detection and Resolution Agent** — a hackathon MVP where an AI ops agent owns an operational problem end-to-end.

**Core loop:** `DETECT → UNDERSTAND → INVESTIGATE → PLAN → ACT → VERIFY → RESOLVE`

> GhostOps AI doesn't just automate workflows. It autonomously owns the problem until it is resolved.

## Demo Scenario

> A customer paid ₹500 for a movie ticket, but the booking was not confirmed.

GhostOps automatically detects the incident, investigates, identifies the probable root cause (`database_timeout`), executes safe remediation (recreates the booking), notifies the responsible team, communicates with the customer, and **verifies the resolution** — all streamed live to the dashboard in real time.

## What It Does

- **Autonomous agent loop** — LLM-backed reasoning with a deterministic heuristic fallback, so it runs with zero API keys.
- **Risk engine** — every action is gated. Low-risk diagnostics auto-execute, medium-risk remediation auto-runs, high-risk financial/destructive actions pause the agent for **human approval**.
- **Real-time SSE** — the agent's every step is streamed (`agent_update`, `tool_completed`, `timeline_event`, `approval_requested`, …) into a live UI.
- **Context tools** — Payment API, database, logs, Jira, Slack, email, plus an n8n webhook trigger.
- **Dual persistence** — Supabase PostgreSQL, or an in-memory seeded adapter so the demo works offline.
- **Simulator** — 4 scenarios that seed fresh data and drive the full loop one click at a time.

## Monorepo Structure

```
GhostOps/
├── frontend/   # React + Vite + Tailwind command center (9 pages, live SSE)
├── backend/    # Express + TypeScript + GhostOps AI agent
└── supabase/   # SQL schema (10 tables + realtime)
```

## Quick Start

### Option A — Zero config (fully offline demo)

```bash
npm install
npm run dev          # starts backend (:4000) + frontend (:5173)
```

No keys needed. The backend boots with an in-memory seeded database and heuristic reasoning. Open `http://localhost:5173`, hit **Simulate Incident**, and watch GhostOps resolve it live.

> Note for Windows PowerShell: if `npm run dev:backend` has trouble resolving `tsx`, run the backend directly with `node ../node_modules/tsx/dist/cli.mjs src/index.ts` from `backend/`.

### Option B — With real OpenAI + Supabase

```bash
cp .env.example .env        # fill in your keys
npm install
npm run seed                # apply supabase/schema.sql + seed demo data
npm run dev
```

- `OPENAI_API_KEY` / `OPENAI_MODEL` → structured-output reasoning (falls back to heuristics when absent)
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` → switches the adapter from memory → Postgres
- Optional: `SLACK_*`, `JIRA_*`, `EMAIL_*`, `N8N_*` enable real integrations (mock adapters otherwise)

## Key Endpoints

| Route | Purpose |
| --- | --- |
| `GET /api/events` | Global SSE stream (`?incidentId=` for per-incident) |
| `GET /api/incidents`, `GET /api/incidents/stats` | List + analytics KPIs |
| `GET /api/incidents/:id` | Detail: incident, timeline, actions, customer, payment, booking |
| `POST /api/incidents/:id/investigate` | Kick off the agent loop |
| `POST /api/incidents/:id/verify` | Verify + resolve |
| `GET /api/agent/activity`, `GET /api/agent/status` | Agent telemetry |
| `GET /api/approvals` · `POST /api/approvals/:id/approve\|reject` | Human-in-the-loop |
| `GET /api/simulate/scenarios` · `POST /api/simulate/run` | Demo scenario driver |
| `POST /api/n8n/webhook` | External trigger (guarded by `OPS_INTAKE_KEY`) |

## Safety Model

GhostOps never executes a destructive action unsolicited.

- **Auto-execute** (low risk): payments, bookings, log/info lookup, notifications
- **Auto + retry** (medium risk): recreate booking, update status, create Jira ticket
- **Human approval** (high risk): refunds, cancellations, config/destructive changes — the agent **pauses**, the UI prompts, and approving resumes the loop