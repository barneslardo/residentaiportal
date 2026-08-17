const fs = require("fs");
const path = require("path");

/** Load repo-root .env into a plain object for PM2 */
function loadEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.trim();
    }
    env[key] = value;
  }
  return env;
}

const rootDir = __dirname;
const fileEnv = loadEnvFile(path.join(rootDir, ".env"));
const logsDir = path.join(rootDir, "logs", "pm2");

if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

module.exports = {
  apps: [
    {
      // Single process: Express serves /api, /auth, /mcp and the built SPA.
      name: "resident-api",
      cwd: path.join(rootDir, "apps/api"),
      script: "dist/index.js",
      interpreter: "node",
      error_file: path.join(logsDir, "resident-api-error.log"),
      out_file: path.join(logsDir, "resident-api-out.log"),
      env: {
        ...process.env,
        ...fileEnv,
        NODE_ENV: "production",
        API_PORT: fileEnv.API_PORT || process.env.API_PORT || "3220",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 50,
      min_uptime: "10s",
      restart_delay: 4000,
      exp_backoff_restart_delay: 2000,
      kill_timeout: 8000,
      listen_timeout: 15000,
      watch: false,
      merge_logs: true,
      time: true,
    },
  ],
};
