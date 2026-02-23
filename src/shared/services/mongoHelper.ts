import { MongoClient, Db } from "mongodb";
import { getSecret } from "./secretsHelper";

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

const CONNECTION_OPTIONS = {
  maxPoolSize: 10,
  minPoolSize: 2,
  maxIdleTimeMS: 30000,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};

interface ConnectionResult {
  success: boolean;
  error?: string;
}

// Connection cache (survives across Lambda invocations)

export const connect = async (): Promise<Db> => {
  // Reuse existing connection
  if (cachedClient && cachedDb) {
    console.log("Reusing cached MongoDB connection");
    return cachedDb;
  }

  console.log("Creating new MongoDB connection...");
  const uri = await getMongoUri();

  cachedClient = new MongoClient(uri, CONNECTION_OPTIONS);
  await cachedClient.connect();

  cachedDb = cachedClient.db();
  console.log("MongoDB connected successfully");

  return cachedDb;
};

const getMongoUri = async (): Promise<string> => {
  const secretId = process.env.MONGODB_SECRET_ID;
  if (!secretId) {
    throw new Error("MONGODB_SECRET_ID environment variable not set");
  }

  const secret = await getSecret(secretId);

  if (typeof secret === "string") {
    return secret;
  }

  return secret.uri || secret.MONGODB_URI || secret.connectionString;
};

export const disconnect = async (): Promise<void> => {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
    cachedDb = null;
    console.log("MongoDB disconnected");
  }
};

export const ping = async (): Promise<ConnectionResult> => {
  try {
    if (!cachedClient || !cachedDb) {
      return {
        success: false,
        error: "Not connected to MongoDB",
      };
    }

    await cachedDb.admin().ping();
    console.log("MongoDB ping successful");

    return { success: true };
  } catch (error) {
    console.error("MongoDB ping failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Ping failed",
    };
  }
};
