import { connectDb, disconnectDb } from '../config/database.js';
import { OrganisationModel } from '../models/organisation.model.js';
import { requeueFailed } from '../models/transaction.model.js';

// For an operator after an incident: puts every organisation's failed
// transactions back in the queue. It goes one organisation at a time through
// the same scoped requeueFailed() the API uses, so the tenant guard still
// applies. A running worker picks the rows up.
async function main(): Promise<void> {
  await connectDb();
  const organisations = await OrganisationModel.find({}, { _id: 1, name: 1 }).lean();
  let total = 0;
  for (const organisation of organisations) {
    const requeued = await requeueFailed(organisation._id.toString());
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
