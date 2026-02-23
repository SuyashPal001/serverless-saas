import express, { Express, Request, Response, NextFunction } from "express";
import Database from "../src/shared/config/mongo";
import cors from "cors";
import { config } from "../src/shared/config/env";

// Import your route handlers

// ADMIN PANEL
// 1. Studio Management
import studioAdminRouter from "./routers/Admin/studioManagement";

// APPLICATIONS

// 2. Studio App
import studioAuthRouter from "./routers/Application/StudioApp/authRouters";
import studioLiveSessionRouter from "./routers/Application/StudioApp/liveSessionRouters";
import studioListRouter from "./routers/Application/StudioApp/studioListRouter";
import studioAppRouter from "./routers/Application/StudioApp/studioRouters";

// 3. FitnEarn Website

const app: Express = express();

class LocalServer {
  // private app: Express;
  private port: number;

  constructor() {
    // this.app = express();
    this.port = Number(process.env.PORT) || 3001;
  }

  // Initialize all configurations
  private async initializeDatabase(): Promise<void> {
    console.log("Connecting to database...");
    await Database.connect();
  }

  private initializeMiddlewares(): void {
    // Body parsing
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // CORS
    const allowedOrigins = [
      "https://dev.example.com",
      "https://admin.example.com",
    ];

    app.use(
      cors({
        origin: (origin, callback) => {
          // Allow server-to-server / Postman / cron calls
          if (!origin) {
            return callback(null, true);
          }
          if (allowedOrigins.includes(origin)) {
            return callback(null, true);
          }
          return callback(new Error("Not allowed by CORS"));
        },
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allowedHeaders: [
          "Content-Type",
          "Authorization",
          "X-Refresh-Token",
          "X-Username",
          "genToken",
        ],
        credentials: true,
      }),
    );

    // Request logging (local only)
    app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`${req.method} ${req.path}`);
      next();
    });
  }

  private initializeRoutes(): void {
    // Health check
    app.get("/health", (req: Request, res: Response) => {
      res.json({
        success: true,
        status: "ok",
        environment: "local",
        timestamp: new Date().toISOString(),
      });
    });
    app.get("/", (req: Request, res: Response) => {
      res.json({
        success: true,
        message: "Server is running now !!",
      });
    });

    // API routess

    // ADMIN
    app.use(studioAdminRouter);

    // APPLICATION
    app.use(studioAuthRouter);
    app.use(studioLiveSessionRouter);
    app.use(studioListRouter);
    app.use(studioAppRouter);

    // 404 handler
    app.use((req: Request, res: Response) => {
      res.status(404).json({ success: false, error: "Route not found" });
    });
  }

  private initializeErrorHandling(): void {
    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      console.error("Error:", err);
      res.status(500).json({
        error: "Internal server error",
        message: config.isDevelopment ? err.message : undefined,
      });
    });
  }

  public async start(): Promise<void> {
    try {
      // Step 1: Connect to database FIRST
      await this.initializeDatabase();

      // Step 2: Setup middlewares
      this.initializeMiddlewares();

      // Step 3: Setup routes
      this.initializeRoutes();

      // Step 4: Setup error handling
      this.initializeErrorHandling();

      // Step 5: Start server
      app.listen(this.port, () => {
        console.log(`
        🚀 Local server running!
        📍 URL: http://localhost:${this.port}
        `);
      });
    } catch (error) {
      console.error("Failed to start server:", error);
      process.exit(1);
    }
  }

  public async stop(): Promise<void> {
    await Database.disconnect();
    console.log("Server stopped");
  }
}

// Start the server!!!
const server = new LocalServer();
server.start();

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  await server.stop();
  process.exit(0);
});

export default app;
