/**
 * Shared test database URL resolution.
 *
 * Tests never touch the real `ghostops` database. During local runs the
 * compose stack exposes Postgres on localhost:5433 with the `ghostops` role;
 * CI provides a postgres:16 service via DATABASE_URL_TEST.
 */
export function testDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL_TEST ??
    process.env.DATABASE_URL ??
    'postgres://ghostops:ghostops_dev_password@localhost:5433/ghostops_test'
  );
}