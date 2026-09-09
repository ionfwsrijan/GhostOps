-- =====================================================
-- GhostOps AI — Supabase PostgreSQL Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL)
-- =====================================================

-- ---------- ENUMS ----------
do $$ begin
  create type incident_status as enum ('detected','investigating','action_required','awaiting_approval','resolving','resolved','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type incident_severity as enum ('critical','high','medium','low');
exception when duplicate_object then null; end $$;

-- ---------- CUSTOMERS ----------
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text unique not null,
  name text not null,
  email text,
  phone text,
  city text,
  loyalty_tier text default 'silver',
  created_at timestamptz default now()
);

-- ---------- PAYMENTS ----------
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  transaction_id text unique not null,
  customer_id uuid references customers(id),
  amount numeric(10,2) not null,
  currency text default 'INR',
  status text not null default 'success',
  payment_method text default 'upi',
  gateway text default 'razorpay',
  paid_at timestamptz default now(),
  created_at timestamptz default now()
);

-- ---------- BOOKINGS ----------
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  booking_code text unique not null,
  customer_id uuid references customers(id),
  payment_id uuid references payments(id),
  movie_title text not null,
  cinema text,
  city text,
  show_time timestamptz,
  seats text[] default '{}',
  amount numeric(10,2),
  status text not null default 'confirmed',
  created_at timestamptz default now()
);

-- ---------- INCIDENTS ----------
create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  incident_code text unique not null,
  title text not null,
  issue text not null,
  description text,
  severity incident_severity not null default 'high',
  status incident_status not null default 'detected',
  customer_id uuid references customers(id),
  transaction_id text,
  affected_service text,
  ai_confidence numeric(4,2),
  root_cause text,
  root_cause_confidence numeric(4,2),
  evidence jsonb,
  resolution_summary text,
  auto_resolved boolean default false,
  channel text default 'support_email',
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_incidents_status on incidents(status);
create index if not exists idx_incidents_created on incidents(created_at desc);

-- ---------- INCIDENT TIMELINE ----------
create table if not exists incident_timeline (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references incidents(id) on delete cascade,
  step text not null,
  type text not null default 'info',
  title text not null,
  description text,
  metadata jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_timeline_incident on incident_timeline(incident_id, created_at);

-- ---------- AGENT ACTIONS ----------
create table if not exists agent_actions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references incidents(id) on delete cascade,
  tool text not null,
  action text not null,
  input jsonb,
  output jsonb,
  result text not null default 'success',
  risk text not null default 'low',
  status text not null default 'executed',
  created_at timestamptz default now()
);

create index if not exists idx_actions_incident on agent_actions(incident_id, created_at);

-- ---------- SYSTEM LOGS ----------
create table if not exists system_logs (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references incidents(id) on delete cascade,
  service text not null,
  level text not null default 'info',
  message text not null,
  metadata jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_logs_incident on system_logs(incident_id, created_at);

-- ---------- TICKETS ----------
create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text unique not null,
  incident_id uuid references incidents(id) on delete cascade,
  integration text default 'jira',
  title text not null,
  status text default 'open',
  priority text default 'high',
  url text,
  created_at timestamptz default now()
);

-- ---------- NOTIFICATIONS ----------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references incidents(id) on delete cascade,
  channel text not null default 'slack',
  recipient text,
  subject text,
  message text,
  status text default 'sent',
  created_at timestamptz default now()
);

-- ---------- APPROVAL REQUESTS ----------
create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references incidents(id) on delete cascade,
  action_key text not null,
  title text not null,
  description text,
  risk text default 'high',
  status text default 'pending',
  ai_recommendation text,
  decision_reason text,
  created_at timestamptz default now(),
  decided_at timestamptz
);

create index if not exists idx_approvals_status on approval_requests(status);

-- ---------- REALTIME ----------
alter publication supabase_realtime add table incidents;
alter publication supabase_realtime add table incident_timeline;
alter publication supabase_realtime add table agent_actions;