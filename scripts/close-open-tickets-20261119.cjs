// One-time cleanup script (requested by the user 2026-11-19): closes every
// ticket that has been OPEN for more than MIN_OPEN_AGE_MS when the script
// runs, without printing or signaling the driver — this is pure admin
// housekeeping to clear out old stuck records, not a normal weighing
// close. A ticket that opened recently (e.g. a truck genuinely on the
// scale right now) is left alone. Scheduled via Windows Task Scheduler to
// run once at 23:59 on 2026-11-19 (task name below); the script deletes
// its own task at the end so it can never run a second time.
//
// Backs up the live DB (online, via better-sqlite3's backup()) before
// touching anything, mirroring the backup-before-mutate procedure used for
// every production redeploy in this repo (see CLAUDE.md).

const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const TASK_NAME = 'EixoLink-CloseOpenTickets-20261119';
const REPO_ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(REPO_ROOT, 'data', 'tare.sqlite');
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backup-before-eod-cleanup-20261119');
const BACKUP_PATH = path.join(BACKUP_DIR, 'tare.online-backup.sqlite');
const MIN_OPEN_AGE_MS = 2 * 60 * 60 * 1000; // 2h — user request 2026-11-19

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = DELETE');
  db.pragma('foreign_keys = ON');

  try {
    log(`Backing up ${DB_PATH} -> ${BACKUP_PATH}`);
    await db.backup(BACKUP_PATH);
    log('Backup complete.');

    const nowMs = Date.now();
    const cutoffMs = nowMs - MIN_OPEN_AGE_MS;

    const totalOpen = db.prepare("SELECT count(*) c FROM tickets WHERE status = 'OPEN'").get().c;
    const openTickets = db
      .prepare(
        "SELECT id, ticket_number, plate, entry_at FROM tickets WHERE status = 'OPEN' AND entry_at IS NOT NULL AND entry_at <= @cutoffMs",
      )
      .all({ cutoffMs });
    log(
      `${totalOpen} OPEN ticket(s) total; ${openTickets.length} have been open for more than ${MIN_OPEN_AGE_MS / 3600000}h and will be closed (the rest are left alone).`,
    );
    const closeStmt = db.prepare(`
      UPDATE tickets
      SET status = 'CLOSED',
          exit_at = @exitAt,
          exit_weight_kg = NULL,
          exit_camera_id = NULL,
          exit_capture_failed = 1,
          net_weight_kg = NULL,
          updated_at = @updatedAt
      WHERE id = @id AND status = 'OPEN'
    `);
    const auditStmt = db.prepare(`
      INSERT INTO ticket_audit_log (ticket_id, actor, action, payload, created_at)
      VALUES (@ticketId, @actor, @action, @payload, @createdAt)
    `);

    const payload = JSON.stringify({
      reason:
        'One-time end-of-day cleanup requested by the user on 2026-11-19: close OPEN tickets open for more than 2h, with no exit weight, no print, no driver signal.',
    });

    const closeOne = db.transaction((ticket) => {
      const result = closeStmt.run({ exitAt: nowMs, updatedAt: nowMs, id: ticket.id });
      if (result.changes !== 1) {
        throw new Error('ticket was not OPEN anymore (closed by normal traffic mid-run) — skipped');
      }
      auditStmt.run({
        ticketId: ticket.id,
        actor: 'cleanup-script',
        action: 'closed_by_eod_cleanup_20261119',
        payload,
        createdAt: nowMs,
      });
    });

    let closed = 0;
    let skipped = 0;
    for (const ticket of openTickets) {
      try {
        closeOne(ticket);
        closed++;
      } catch (err) {
        skipped++;
        log(`Skipped ticket ${ticket.id} (${ticket.plate}): ${err.message}`);
      }
    }

    log(`Done. Closed ${closed} ticket(s), skipped ${skipped}.`);
  } finally {
    db.close();
  }

  try {
    const { execSync } = require('node:child_process');
    execSync(`schtasks /Delete /TN "${TASK_NAME}" /F`, { stdio: 'ignore' });
    log(`Deleted scheduled task "${TASK_NAME}" (one-time run complete).`);
  } catch (err) {
    log(`Could not delete scheduled task "${TASK_NAME}" — remove it manually: ${err.message}`);
  }
}

main().catch((err) => {
  console.error('Cleanup script failed:', err);
  process.exitCode = 1;
});
