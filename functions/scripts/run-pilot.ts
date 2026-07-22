import { createHistoricalOptionsPilotService } from '../src/v2/historical-options-corpus/services/pilot.service';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const execute = args.includes('--execute');
  const maxTradingDatesPerSymbol = 20;

  const bucketName = process.env.OPTIONS_CORPUS_BUCKET;
  if (!bucketName) {
    throw new Error('OPTIONS_CORPUS_BUCKET environment variable is required');
  }

  console.log(`Starting pilot: dryRun=${dryRun}, execute=${execute}, bucket=${bucketName}`);

  const service = createHistoricalOptionsPilotService(bucketName);
  const report = await service.run({
    dryRun,
    execute,
    maxTradingDatesPerSymbol,
  });

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
