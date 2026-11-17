import mongoose from 'mongoose';
import { config } from './env.js';

let connected = false;

// useBigInt64 makes amountKobo come back as a plain bigint instead of the
// mongodb.Long wrapper object.
export async function connectDb(): Promise<typeof mongoose> {
  if (connected) {
    return mongoose;
  }
  await mongoose.connect(config.MONGO_URI, {
    useBigInt64: true,
  } as mongoose.ConnectOptions & { useBigInt64: boolean });
  connected = true;
  return mongoose;
}

export async function disconnectDb(): Promise<void> {
  if (!connected) {
    return;
  }
  await mongoose.disconnect();
  connected = false;
}
