// import { Router } from "express";
// import { connectMongo } from "@common/db/mongo";

// const router = Router();
// const response = {
//   status: "healthy",
//   message: "Service is running",
//   version: "2.0.0",
//   env: process.env.ENV || "local",
//   timestamp: new Date().toISOString(),
// };
// router.get("/", async (_req, res) => {
//   console.log("inside pin api");
//   await connectMongo(process.env.MONGO_URI!);
//   console.log("inside pin api");
//   return res.status(200).json({ success: true, response });
// });

// export default router;
