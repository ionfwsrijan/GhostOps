import { describe, expect, it } from 'vitest';
import { ACTION_TO_TOOL } from '../../src/tools/mapping.js';
import { listActionDefinitions } from '../../src/services/riskEngine.js';
import { isToolAllowed } from '../../src/tools/index.js';

describe('ACTION_TO_TOOL mapping contract', () => {
  it('covers every allowlisted action key exactly once', () => {
    const registryKeys = listActionDefinitions().map((d) => d.key);
    expect(Object.keys(ACTION_TO_TOOL).sort()).toEqual(registryKeys.sort());
  });

  it('every mapped tool exists in the executor registry', () => {
    for (const tool of Object.values(ACTION_TO_TOOL)) {
      if (tool === null) continue;
      expect(isToolAllowed(tool), `tool "${tool}" must be registered`).toBe(true);
    }
  });

  it('destructive guardrail actions have no automated executor', () => {
    for (const key of ['delete_records', 'modify_sensitive_data', 'change_configuration']) {
      expect(ACTION_TO_TOOL[key]).toBeNull();
    }
  });

  it('remediation maps to concrete executors', () => {
    expect(ACTION_TO_TOOL.retry_booking).toBe('retry_booking');
    expect(ACTION_TO_TOOL.verify_payment).toBe('verify_transaction');
    expect(ACTION_TO_TOOL.inspect_logs).toBe('search_logs');
  });
});