# GhostOps AI

**Autonomous Problem Detection and Resolution Agent**

GhostOps AI is an autonomous AI operations agent that takes ownership of an operational problem from detection to resolution.

**Core loop:** DETECT → UNDERSTAND → INVESTIGATE → PLAN → ACT → VERIFY → RESOLVE

> GhostOps AI doesn't just automate workflows. It autonomously owns the problem until it is resolved.

## Demo Scenario

> A customer paid ₹500 for a movie ticket, but the booking was not confirmed.

GhostOps automatically investigates the issue, identifies the probable root cause, executes safe remediation, updates the relevant systems, notifies the responsible team, communicates with the customer, and verifies whether the issue has actually been resolved.

## Monorepo Structure

```
GhostOps/
├── frontend/   # React + Vite + Tailwind dashboard
├── backend/    # Express + TypeScript + GhostOps AI agent
└── supabase/   # SQL schema and seed data
```

## Quick Start

See [README](frontend/README.md) and [backend README](backend/README.md) for detailed setup. Basic:

```bash
cp .env.example .env   # fill in OpenAI + Supabase keys
npm install
npm run seed          # create tables + demo data in Supabase
npm run dev           # starts backend (:4000) and frontend (:5173)
```