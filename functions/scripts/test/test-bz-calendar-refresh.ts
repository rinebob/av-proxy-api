import { setupEmulator } from '../scripts-util';
setupEmulator();

import '../src/firebase-admin-init';
import { runBenzingaCalendarRefreshJob } from '../../src/v2/benzinga/data-refresher/bz-calendar-refresh-manager';

// Initialize Firebase Admin with local credentials for emulator/dev
declare const process: any;

async function main() {
  try {
    console.log('Starting Benzinga Calendar Refresh test...');
    await runBenzingaCalendarRefreshJob();
    console.log('Benzinga Calendar Refresh completed successfully.');
  } catch (err) {
    console.error('Error running Benzinga Calendar Refresh:', err);
  } finally {
    process.exit();
  }
}

main();
