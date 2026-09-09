import { Incident } from '../database/types.js';
import { classificationSchema, rootCauseSchema, actionPlanSchema, catalogSnippet, Classification, RootCauseAnalysis, ActionPlan, incidentTypes } from './schemas.js';
import { structuredCompletion } from './llm.js';
import { classifyHeuristically, analyzeRootCauseHeuristically, planHeuristically, RawEvidence } from './heuristics.js';

const CLASSIFICATION_JSON_SCHEMA = {
  name: 'incident_classification',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      incidentType: { type: 'string', enum: [...incidentTypes] },
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
      entities: {
        type: 'object',
        properties: {
          transactionId: { type: ['string', 'null'] },
          customerId: { type: ['string', 'null'] },
          amount: { type: ['number', 'null'] },
        },
        required: ['transactionId', 'customerId', 'amount'],
        additionalProperties: false,
      },
      summary: { type: 'string' },
      investigationPlan: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number' },
    },
    required: ['incidentType', 'severity', 'entities', 'summary', 'investigationPlan', 'confidence'],
    additionalProperties: false,
  },
};

const ROOT_CAUSE_JSON_SCHEMA = {
  name: 'root_cause_analysis',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      rootCause: {
        type: 'string',
        enum: ['database_timeout', 'db_connection_pool_exhaustion', 'api_timeout', 'duplicate_transaction', 'idempotency_key_missing', 'payment_gateway_failure', 'webhook_processing_backlog', 'expired_token_rotation', 'misconfiguration', 'unknown'],
      },
      confidence: { type: 'number' },
      explanation: { type: 'string' },
      evidence: { type: 'array', items: { type: 'string' } },
      nextInvestigationSteps: { type: 'array', items: { type: 'string' } },
    },
    required: ['rootCause', 'confidence', 'explanation', 'evidence', 'nextInvestigationSteps'],
    additionalProperties: false,
  },
};

const ACTION_PLAN_JSON_SCHEMA = {
  name: 'action_plan',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      reasoning: { type: 'string' },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            actionKey: { type: 'string' },
            params: { type: 'object', additionalProperties: true },
            confidence: { type: 'number' },
            reasoning: { type: 'string' },
          },
          required: ['actionKey', 'params', 'confidence', 'reasoning'],
          additionalProperties: false,
        },
      },
    },
    required: ['reasoning', 'actions'],
    additionalProperties: false,
  },
};

export async function classifyIncident(incident: Incident): Promise<Classification> {
  const heuristic = classifyHeuristically(incident);

  const user = [
    `Incident: ${incident.incident_code} — ${incident.title}`,
    `Issue: ${incident.issue}`,
    incident.description ? `Details: ${incident.description}` : '',
    incident.affected_service ? `Affected service: ${incident.affected_service}` : '',
    incident.transaction_id ? `Transaction: ${incident.transaction_id}` : '',
    '',
    'Classify this incident. Choose an investigation plan ONLY from these tools:',
    catalogSnippet(),
  ].join('\n');

  const ai = await structuredCompletion({
    system: 'You are GhostOps AI. Classify the incident and produce a JSON object with incidentType, severity, entities, summary, investigationPlan (array of tool names from the provided catalog), and confidence.',
    user,
    schema: classificationSchema,
    jsonSchema: CLASSIFICATION_JSON_SCHEMA,
  });

  if (!ai) return heuristic;

  // Validate the LLM's tool choices against the catalog — no arbitrary tools.
  const allowed = new Set(['verify_transaction', 'check_booking', 'db_find_record', 'db_check_duplicate', 'search_logs']);
  const plan = (ai.investigationPlan ?? []).filter((t) => allowed.has(t));
  const merged: Classification = {
    incidentType: ai.incidentType,
    severity: ai.severity,
    entities: {
      transactionId: ai.entities.transactionId ?? incident.transaction_id ?? null,
      customerId: ai.entities.customerId ?? incident.customer_id ?? null,
      amount: ai.entities.amount ?? helperAmount(incident),
    },
    summary: ai.summary || heuristic.summary,
    investigationPlan: plan.length ? plan : heuristic.investigationPlan,
    confidence: ai.confidence,
  };
  return merged;
}

export async function analyzeEvidence(incident: Incident, evidence: RawEvidence[]): Promise<RootCauseAnalysis> {
  const heuristic = analyzeRootCauseHeuristically(incident, evidence);

  const user = [
    `Incident: ${incident.incident_code} — ${incident.title}`,
    'Evidence gathered by GhostOps:',
    ...evidence.map((e) => `- ${e.tool}: ${e.summary ?? (e.ok ? 'ok' : 'failed')}`),
    '',
    'Reason about the most probable root cause from this evidence. Be conservative and factual.',
  ].join('\n');

  const ai = await structuredCompletion({
    system: 'You are GhostOps AI. Analyze evidence and produce a JSON object with rootCause, confidence (0-1), explanation, evidence (array of strings), and nextInvestigationSteps (array of tool names).',
    user,
    schema: rootCauseSchema,
    jsonSchema: ROOT_CAUSE_JSON_SCHEMA,
  });

  if (!ai) return heuristic;

  return {
    rootCause: ai.rootCause,
    confidence: ai.confidence,
    explanation: ai.explanation || heuristic.explanation,
    evidence: ai.evidence?.length ? ai.evidence : heuristic.evidence,
    nextInvestigationSteps: ai.nextInvestigationSteps ?? heuristic.nextInvestigationSteps,
  };
}

export async function generateActionPlan(incident: Incident, analysis: RootCauseAnalysis): Promise<ActionPlan> {
  const heuristic = planHeuristically(incident, analysis);

  const user = [
    `Incident: ${incident.incident_code} — ${incident.title}`,
    `Root cause: ${analysis.rootCause} (confidence ${Math.round(analysis.confidence * 100)}%)`,
    `Explanation: ${analysis.explanation}`,
    '',
    'Produce an action plan. ONLY use action keys from this allowed registry:',
    [
      'verify_payment, check_booking, inspect_logs, retry_booking, update_booking_status',
      'create_jira_ticket, send_slack_notification, send_customer_notification, collect_diagnostics',
      'refund_customer, delete_records, modify_sensitive_data, change_configuration, cancel_booking',
    ].join(', '),
    'Prefer the smallest set of safe actions that resolves the issue. Never include destructive actions unless they are the only way to resolve.',
  ].join('\n');

  const ai = await structuredCompletion({
    system: 'You are GhostOps AI. Generate a remediation action plan as JSON: { reasoning, actions: [{ actionKey, params, confidence, reasoning }] }.',
    user,
    schema: actionPlanSchema,
    jsonSchema: ACTION_PLAN_JSON_SCHEMA,
    temperature: 0.3,
  });

  if (!ai) return heuristic;
  return ai;
}

function helperAmount(incident: Incident): number | null {
  return (incident.metadata?.amount as unknown as number | undefined) ?? null;
}