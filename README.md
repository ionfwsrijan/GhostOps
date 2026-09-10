# GhostOps AI

**Autonomous Problem Detection and Resolution Agent** — a hackathon MVP where an AI ops agent owns an operational problem end-to-end.

**Core loop:** `DETECT → UNDERSTAND → INVESTIGATE → PLAN → ACT → VERIFY → RESOLVE`

> GhostOps AI doesn't just automate workflows. It autonomously owns the problem until it is resolved.

## Demo Scenario

> A customer paid ₹500 for a movie ticket, but the booking was not confirmed.

GhostOps detects the incident (via API, webhook or support ticket), investigates it, identifies the probable root cause (`database_timeout`), executes safe remediation (recreates the booking), notifies the responsible team, communicates with the customer, and **verifies the resolution** — all streamed live to the dashboard in real time. High-risk remediation (refunds, config changes, deletions) **pauses for human approval** before anything irreversible happens.

## What It Does

- **Autonomous agent worker** — a Postgres-backed job queue drives the full loop: classify → investigate → analyze root cause → plan → act → verify. Multiple workers can run; jobs are leased with `SKIP LOCKED`.
- **LLM-first reasoning with zero-key fallback** — structured-output OpenAI reasoning (default `gpt-4o-mini`), falling back to a deterministic heuristic engine when no API key is set. The demo runs fully offline.
- **Risk engine** — every action is gated through an allowlist registry. Low-risk diagnostics auto-execute, medium-risk remediation auto-runs above a confidence threshold, high-risk financial/destructive actions always pause the agent for **human approval**.
- **Real-time SSE** — every agent step streams to the dashboard (`agent_update`, `timeline_event`, `tool_completed`, `action_executed`, `approval_requested`, `incident_detected`, …).
- **Human-in-the-loop approvals** — pending approvals with TTL expiry; an approve/reject decision resumes the paused run exactly where it stopped.
- **HMAC-gated webhooks** — `payment`, `booking`, `monitoring` and `support` intake, each with its own shared secret (`X-GhostOps-Signature: sha256=<hex>` over the raw body).
- **Machine-to-machine intake** — API keys (`gho_live_...`) with `read`/`write`/`ingest` scopes authenticate external systems.
- **Outbox relay** — outbound Slack / Jira / email / n8n notifications go through a guaranteed-delivery outbox with leases, retries and skip-on-not-configured.
- **Full observability** — append-only audit log, Prometheus metrics (`/metrics`), health/readiness probes, OpenAPI spec, and a 63-test vitest + supertest suite.

## Architecture & Layout

```
GhostOps/
├── backend/     # Express + TypeScript agent, worker, Postgres repos, tools, risk engine
│   ├── src/
│   │   ├── ai/          # LLM reasoning (llm.ts, schemas) + heuristic fallback (heuristics.ts)
│   │   ├── agents/      # agentRunner.ts — the phase machine (resumable)
│   │   ├── tools/       # strict input-schema tool executors (mapped 1:1 to actions)
│   │   ├── services/    # risk engine, actions, incidents, integrations/outbox, SSE, audit
│   │   ├── db/          # node-pg-migrate migrations + repositories
│   │   └── routes/v1/   # auth, incidents, dashboard, ops (webhooks/outbox/audit), system
│   ├── migrations/      # SQL migrations (initial schema, outbox lease, payments)
│   └── test/            # vitest + supertest integration/unit suite
├── frontend/    # React + Vite + Tailwind command center (12 pages, live SSE)
└── docker-compose.yml   # Postgres 16, backend, frontend
```

## Quick Start (recommended: full Docker Compose)

Requires Docker + Docker Compose, and Node 22 (for local tooling).

```bash
git clone https://github.com/ionfwsrijan/GhostOps.git
cd GhostOps
npm ci

# Optionally set a known admin password before first boot:
$env:ADMIN_INITIAL_PASSWORD = "change-me-please"      # PowerShell
# export ADMIN_INITIAL_PASSWORD=change-me-please       # bash

# set compose env in the SAME shell that runs compose up
$env:POSTGRES_USER="ghostops"; $env:POSTGRES_PASSWORD="ghostops_dev_password"; $env:POSTGRES_DB="ghostops"
docker compose up -d --build
```

What you get:

| Service | URL |
| --- | --- |
| Frontend (Vite preview, proxies `/api`) | http://localhost:5173 |
| Backend API + worker | http://localhost:4000 |
| Postgres 16 | `localhost:5433` (`ghostops` / `ghostops_dev_password` / db `ghostops`) |

The backend container runs `node-pg-migrate up` on boot, so the schema is applied automatically.

### Login

On first boot GhostOps creates a bootstrap admin:

- Email: `$ADMIN_EMAIL` or `admin@ghostops.local`
- Password: `$ADMIN_INITIAL_PASSWORD`, **or a random one printed once in the backend logs** (`auth: created bootstrap admin ... temporary password ...`).

Sign in at http://localhost:5173, then create other users and ingest API keys from **Settings → Ingest → API keys** (admin/operator only).

## Local development (no containers)

You need a reachable Postgres with a database ready:

```bash
npm ci
# put DATABASE_URL in backend/.env (config is validated at boot)
# e.g. DATABASE_URL=postgres://ghostops:ghostops_dev_password@localhost:5433/ghostops
npm run migrate --workspace=backend
npm run dev          # backend :4000 + frontend :5173 (concurrently)
```

> PowerShell note: if `npm run dev:backend` struggles resolving `tsx`, run `node ../node_modules/tsx/dist/cli.mjs src/index.ts` from `backend/`.

Backend env lives in `backend/.env` (dotenv). Root `.env` is read by Docker Compose only. Copy variables from `.env.example` — the backend refuses to boot with an invalid/missing `DATABASE_URL`; optional keys degrade gracefully and are surfaced in `/health` and `/meta`.

## How the Agent Works

### Reasoning engine

- **LLM mode** — `OPENAI_API_KEY` + `OPENAI_MODEL` enabled. Classification, root-cause analysis and planning are JSON-schema-constrained completions; low confidence in a step automatically falls back to heuristics.
- **Heuristic mode (zero API keys)** — deterministic keyword/evidence-based classify → root-cause → plan pipeline. Perfect for the offline demo and tests.

### Run phases (resumable, persisted per run)

`classifying → investigating → analyzing → planning → acting → verifying`

Each phase persists a run snapshot, phases are throttled (`AGENT_STEP_DELAY_MS`) and streamed via SSE. Approval resumes skip already-completed phases and continue from the stored plan index.

### Incident lifecycle

`detected → investigating → action_required → awaiting_approval → resolving → resolved`

Failures land in `failed`; operators can `cancelled` a run or `reinvestigate` any incident manually.

## Safety Model

GhostOps only ever executes an action on the allowlist `GET /api/v1/incidents/action-definitions`. Each action declares a risk level and a human-approval threshold:

| Risk | Behavior | Examples |
| --- | --- | --- |
| **Low** | auto-execute (threshold 0, or ≥0.5) | verify payment, check booking, inspect logs, create Jira ticket, notify Slack/customer |
| **Medium** | auto-execute at confidence ≥ threshold, else ask | update booking status (≥0.8), cancel booking (≥0.85) |
| **High** | **always human approval** | refund customer, delete records, modify sensitive data, change production config |

A pending approval pauses the run; an operator decision (approve/reject + optional reason) either resumes the plan or marks the action rejected, and expired approvals (`APPROVAL_TTL_HOURS`, default 24h) fail the run safely.

## API Overview

Everything is under `/api/v1` (OpenAPI: `/api/v1/openapi.json`, ugly-basic docs at `/api/v1/docs`).

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /auth/login` `POST /auth/logout` `GET /auth/me` | session | cookie-session auth (`ghostops_session`) |
| `GET/POST /auth/users`, `PATCH /auth/users/:id` | admin | user management |
| `GET/POST /auth/api-keys`, `POST /auth/api-keys/:id/revoke` | admin/operator (revoke: admin) | machine keys (`gho_live_*`) |
| `POST /incidents` | API key `ingest` | machine intake → incident + agent queue |
| `GET /incidents` `GET /incidents/:id` `GET /incidents/stats` | session | list (paginated, filterable), detail `{incident, events, actions, approvals, runs}`, KPI stats |
| `GET /incidents/action-definitions` | session | risk-engine allowlist |
| `POST /incidents/:id/reinvestigate` `POST /incidents/:id/cancel` | session (roles) | manual agent kick / cancel |
| `GET/POST /incidents/:id/actions` | session | action history / manual recommended action |
| `GET /incidents/:id/approvals` `POST /approvals/:approvalId` | session | approvals + decide (`{decision: approved\|rejected, reason}`) |
| `POST /incidents/reconcile` | admin | enqueue reconcile job |
| `GET /approvals?status=` `GET /actions` | session | dashboard lists (joined incident codes) |
| `GET /agent/status` `GET /agent/activity` | session | worker telemetry + live activity |
| `GET /health` `GET /ready` `GET /metrics` `GET /meta` | public / any-auth | probes, Prometheus metrics, worker/meta |
| `GET /events` | session | SSE stream (`?incidentId=` for per-incident) |
| `POST /webhooks/payment\|booking\|monitoring\|support` | HMAC | inbound provider events |
| `GET /outbox` | admin/operator | outbound delivery state |
| `GET /audit` | admin/operator | append-only audit trail |

### Manual ingest example

```bash
# create an API key (UI: Ingest page, or)
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ghostops.local","password":"change-me-please"}' -c cookies.txt

curl -X POST http://localhost:4000/api/v1/auth/api-keys \
  -b cookies.txt -H "Content-Type: application/json" \
  -d '{"name":"demo","scope":["ingest"]}'

# → {"apiKey":{"id":"…","prefix":"gho_live_…","scope":["ingest"],"secret":"gho_live_….………"}}

curl -X POST http://localhost:4000/api/v1/incidents \
  -H "Authorization: Bearer gho_live_......." -H "Content-Type: application/json" \
  -d '{"title":"Payment failed","issue":"Payment machine reported failure but the customer may have been charged","transactionId":"TXN-12345","severity":"high"}'
# → 201 {"incidentId":"…","code":"INC-…","queued":true}   (agent picks it up ~1s later)
```

### Webhook example

```bash
# set PAYMENT_WEBHOOK_SECRET before boot; body is signed as raw bytes
SECRET=your-payment-secret
BODY='{"event":"payment.received","data":{"transaction":{"id":"TXN-12345","status":"captured","amount":500},"customer":{"name":"Priya"}}}'
"SIGNATURE=sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')"

curl -X POST http://localhost:4000/api/v1/webhooks/payment \
  -H "Content-Type: application/json" -H "X-GhostOps-Signature: $SIGNATURE" \
  --data-binary "$BODY"
```

Providers without a configured secret are rejected (`INTEGRATION_NOT_CONFIGURED`) — secure by default.

## Integrations & Delivery

- **Slack, Jira, email (SMTP), n8n** — enabled via `*_ENABLED` + credential env vars; state/health surfaces on **Integrations** and in `/meta`. Outbound messages go through the `outbox` relay (leased, retried, skipped when not configured), inspected via `GET /outbox`.
- **Payment provider polling** — `PAYMENT_PROVIDER_API_URL` + `PAYMENT_PROVIDER_API_KEY` enable gateway polling; otherwise intake is webhook/API driven.
- **SSE event stream** — `incident_detected`, `incident_status`, `incident_resolved`, `incident_update`, `action_executed`, `approval_requested`, `tool_completed`, `agent_update`, `timeline_event`.

## Tests & CI

```bash
npm test --workspace=backend              # vitest + supertest, needs a Postgres test DB
npm run typecheck --workspace=backend
npm run build                             # backend + frontend production builds
```

The integration suite provisions a dedicated `ghostops_test` database (created/dropped per run) and covers agents (full auto-resolution, human-in-the-loop approvals, approval-resume), auth/API keys/roles, webhook HMAC intake, risk engine, heuristics, tool mapping and reconcile. GitHub Actions CI (`.github/workflows/ci.yml`) runs typecheck + build + tests against a Postgres 16 service on every push.

## Notable Environment Variables

Backend (`backend/.env` or compose service env) — validated at boot by `src/config.ts`:

- **Required:** `DATABASE_URL` (postgres URL)
- **Auth:** `SESSION_SECRET` (≥32 chars), `SESSION_TTL_DAYS`, `COOKIE_SECURE`, `INTEGRATIONS_ENCRYPTION_KEY` (≥32 chars)
- **Agent:** `AGENT_MAX_CONCURRENT_RUNS`, `AGENT_STEP_DELAY_MS`, `AGENT_JOB_MAX_ATTEMPTS`, `AGENT_CYCLE_BUDGET_MS`, `APPROVAL_TTL_HOURS`, `WORKER_POLL_INTERVAL_MS`
- **AI:** `OPENAI_API_KEY`, `OPENAI_MODEL`
- **Integrations:** `SLACK_WEBHOOK_URL`, `JIRA_*`, `SMTP_*`, `N8N_*`, `PAYMENT_PROVIDER_*`
- **Webhook secrets:** `PAYMENT_WEBHOOK_SECRET`, `BOOKING_WEBHOOK_SECRET`, `MONITORING_WEBHOOK_SECRET`, `SUPPORT_WEBHOOK_SECRET`
- **Bootstrap admin:** `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD`

Compose-only: `POSTGRES_USER/PASSWORD/DB`, `POSTGRES_PORT`, `CORS_ORIGIN`.