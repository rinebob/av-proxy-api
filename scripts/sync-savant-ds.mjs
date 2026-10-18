/**
 * Refresh vendor/savant-ds from the sibling ../savant-ds checkout.
 *
 * vendor/ is the committed source cloud builds consume (the sibling path
 * doesn't exist in App Hosting workspaces — same lesson as rel-str #1071).
 * ../savant-ds remains the source of truth; run this after package edits.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const DS = path.resolve('..', 'savant-ds');
const VENDOR = path.resolve('vendor', 'savant-ds');

if (!existsSync(path.join(DS, 'styles'))) {
  console.error(`sibling checkout not found at ${DS} — clone savant-ds next to av-proxy-api`);
  process.exit(1);
}

for (const entry of ['styles', 'package.json']) {
  rmSync(path.join(VENDOR, entry), { recursive: true, force: true });
  cpSync(path.join(DS, entry), path.join(VENDOR, entry), { recursive: true });
}

const dirty = execSync('git status --porcelain vendor/savant-ds', { encoding: 'utf8' }).trim();
console.log(dirty ? `vendor refreshed — changes to commit:\n${dirty}` : 'vendor already in sync — nothing changed');
