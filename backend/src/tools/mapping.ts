/**
 * Maps risk-engine ACTION KEYS (verify_payment, inspect_logs, ...) to the
 * concrete executor TOOL NAME in the allowlisted registry (verify_transaction,
 * search_logs, ...). `null` means the action is recognized but deliberately
 * has NO automated executor (review-destroying guardrails).
 */
export const ACTION_TO_TOOL: Record<string, string | null> = {
  verify_payment: 'verify_transaction',
  check_booking: 'check_booking',
  inspect_logs: 'search_logs',
  retry_booking: 'retry_booking',
  update_booking_status: 'update_booking_status',
  create_jira_ticket: 'create_jira_ticket',
  send_slack_notification: 'send_slack_notification',
  send_customer_notification: 'send_customer_notification',
  collect_diagnostics: 'collect_diagnostics',
  refund_customer: 'refund_customer',
  cancel_booking: 'cancel_booking',
  delete_records: null,
  modify_sensitive_data: null,
  change_configuration: null,
};