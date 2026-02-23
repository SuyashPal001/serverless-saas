import mongoose, { Mongoose } from "mongoose";

type MongoCache = {
  conn: Mongoose | null;
  promise: Promise<Mongoose> | null;
};

const globalAny = globalThis as unknown as {
  __mongo?: MongoCache;
};

const cache: MongoCache =
  globalAny.__mongo || (globalAny.__mongo = { conn: null, promise: null });

export async function connectMongo(): Promise<Mongoose> {
  if (cache.conn) {
    console.log("Reusing cached MongoDB connection");
    return cache.conn;
  }

  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not defined");
    throw new Error("MONGO_URI is not defined");
  }

  if (!cache.promise) {
    console.log("Making new DB Connection");
    // console.log("MONGO-URI:", process.env.MONGO_URI);
    cache.promise = mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 10, // ✅ connection pooling
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      bufferCommands: false,
    });
  }

  cache.conn = await cache.promise;
  console.log("DB is connected ✅");
  return cache.conn;
}
