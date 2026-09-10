exports.up = (pgm) => {
  pgm.addColumns('outbox', {
    instance_id: { type: 'text' },
    locked_at: { type: 'timestamptz' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('outbox', ['instance_id', 'locked_at']);
};