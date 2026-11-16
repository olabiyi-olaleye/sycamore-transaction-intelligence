import mongoose from 'mongoose';
import { config } from '../config/env.js';

let connected = false;

// useBigInt64 makes the driver deserialise BSON Long as native bigint instead
// of the mongodb.Long wrapper object, so amountKobo round-trips as bigint with
// no manual conversion at the call site.
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
