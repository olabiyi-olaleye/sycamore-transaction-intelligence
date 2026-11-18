import { disconnectDb, systemDb } from '../db/client.js';
import { requeueFailed } from '../repositories/transactions.repository.js';

// For an operator after an incident: puts every organisation's failed
// transactions back in the queue. Listing the organisations needs the system
// role; the requeue itself goes one organisation at a time through the same
// scoped function the API uses, so row-level security still applies to it.
async function main(): Promise<void> {
  const organisations = await systemDb().organisation.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  let total = 0;
  for (const organisation of organisations) {
    const requeued = await requeueFailed(organisation.id);
    if (requeued > 0) console.log(`  ${organisation.name}: ${requeued}`);
    total += requeued;
  }
  console.log(`Requeued ${total} failed transaction(s).`);
  await disconnectDb();
}

main().catch(async (error) => {
  console.error('Requeue failed', error);
  await disconnectDb();
  process.exit(1);
});
