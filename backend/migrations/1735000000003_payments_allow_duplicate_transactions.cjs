/**
 * Payments were created with a UNIQUE constraint on transaction_id, which made
 * the risk engine's `duplicate_transaction` detection (and the refund flow that
 * keys off it) unreachable — a duplicate payment can never exist if the schema
 * forbids a second row. Relax to a plain index so momentary double-charges
 * (two payments, same transaction snapshot) are representable and detectable.
 */

exports.up = (pgm) => {
  pgm.dropConstraint('payments', 'payments_transaction_id_key');
  pgm.createIndex('payments', 'transaction_id');
};

exports.down = (pgm) => {
  pgm.dropIndex('payments', 'transaction_id');
  pgm.addConstraint('payments', 'payments_transaction_id_key', { unique: ['transaction_id'] });
};

exports.shorthands = undefined;