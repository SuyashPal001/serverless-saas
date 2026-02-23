const { spawn } = require("child_process");

const PORT = process.env.PORT || "3000";

const sam = spawn(
  "sam",
  ["local", "start-api", "--port", PORT, "--env-vars", "env.json"],
  {
    stdio: "inherit",
    shell: true,
  }
);

sam.on("exit", (code) => {
  process.exit(code);
});
