import mongoose from "mongoose";

class Database {
  private static instance: Database;
  private isConnected: boolean = false;

  private constructor() {}

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      console.log("Using existing database connection");
      return;
    }

    try {
      const mongoUri = process.env.MONGO_URI as string;

      await mongoose.connect(mongoUri, {
        // Connection options
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
      });

      this.isConnected = true;
      console.log("MongoDB connected successfully");
    } catch (error) {
      console.error("MongoDB connection error:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;

    await mongoose.disconnect();
    this.isConnected = false;
    console.log("MongoDB disconnected");
  }

  getConnection() {
    return mongoose.connection;
  }
}

export default Database.getInstance();
