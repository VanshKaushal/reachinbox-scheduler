import { readFile } from 'node:fs/promises';
import { db, execute, rows } from '../db.js';
import { logger } from '../logger.js';

const conn = await db.getConnection();
try {
  // Only trusted, version-controlled SQL is split/executed here. Runtime queries are parameterized.
  const [lock] = await rows<{ acquired: number }>(
    "SELECT GET_LOCK('reachinbox_schema_migrations', 30) AS acquired",
    [],
    conn,
  );
  if (lock?.acquired !== 1) throw new Error('Could not acquire migration lock');
  await execute(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    [],
    conn,
  );
  for (const version of [1, 2]) {
    const applied = await rows<{ version: number }>(
      'SELECT version FROM schema_migrations WHERE version = ?',
      [version],
      conn,
    );
    if (applied.length) continue;
    const sql = await readFile(
      new URL(`../../sql/${String(version).padStart(3, '0')}.sql`, import.meta.url),
      'utf8',
    );
    const existingIndex =
      version === 2
        ? await rows('SHOW INDEX FROM senders WHERE Key_name = ?', ['idx_sender_user_email'], conn)
        : [];
    if (!existingIndex.length)
      for (const statement of sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await execute(statement, [], conn);
    await execute('INSERT IGNORE INTO schema_migrations (version) VALUES (?)', [version], conn);
  }
  logger.info('Database schema is ready');
} finally {
  await rows("SELECT RELEASE_LOCK('reachinbox_schema_migrations')", [], conn);
  conn.release();
  await db.end();
}
