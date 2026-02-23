import express from "express";

const app = express();

app.use(express.json());

app.get("/ping", (_req, res) => {
  console.log("running ping");
  res.json({ message: "pong" });
});

// 🔴 MUST BE LAST
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("EXPRESS ERROR:", err);
  res.status(500).json({ error: "Internal error" });
});

export default app;

// const { success } = require('../../shared/response');

// exports.lambdaHandler = async (event, context) => {
//   try {
//     const response = {
//       message: 'pong',
//       env: process.env.ENV,
//       timestamp: new Date().toISOString()
//     };
//     return success(response);
//   } catch (err) {
//     console.error('Handler error:', err);
//     return error('Internal server error', 500);
//   }
// };
