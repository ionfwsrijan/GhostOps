import { describe, expect, it } from 'vitest';
import {
  UnknownActionError,
  getActionDefinition,
  isAllowedAction,
  listActionDefinitions,
  requiresHumanApproval,
} from '../../src/services/riskEngine.js';

describe('action registry', () => {
  it('rejects unknown actions', () => {
    expect(() => getActionDefinition('drop_all_tables')).toThrow(UnknownActionError);
    expect(isAllowedAction('drop_all_tables')).toBe(false);
    expect(isAllowedAction('refund_customer')).toBe(true);
  });

  it('exposes a stable allowlist', () => {
    const defs = listActionDefinitions();
    expect(defs.length).toBeGreaterThan(10);
    expect(new Set(defs.map((d) => d.key)).size).toBe(defs.length);
  });
});

describe('requiresHumanApproval', () => {
  it('always gates high-risk actions', () => {
    for (const key of ['refund_customer', 'delete_records', 'modify_sensitive_data', 'change_configuration']) {
      const d = requiresHumanApproval(key, 0.99);
      expect(d.required).toBe(true);
      expect(d.reason).toMatch(/HIGH risk/);
      expect(getActionDefinition(key).autoExecuteThreshold).toBe(1);
    }
  });

  it('auto-executes low-risk diagnostics regardless of confidence', () => {
    expect(requiresHumanApproval('verify_payment', 0.01).required).toBe(false);
    expect(requiresHumanApproval('inspect_logs', 0).required).toBe(false);
    expect(requiresHumanApproval('check_booking', 0).required).toBe(false);
  });

  it('requires approval when confidence is below the threshold', () => {
    const d = requiresHumanApproval('update_booking_status', 0.5);
    expect(d.required).toBe(true);
    expect(d.reason).toMatch(/below auto-execute threshold/);
  });

  it('auto-executes when confidence meets the threshold', () => {
    expect(requiresHumanApproval('retry_booking', 0.7).required).toBe(false);
    expect(requiresHumanApproval('update_booking_status', 0.85).required).toBe(false);
  });
});