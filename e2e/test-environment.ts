import path from "node:path";

export const stage9Environment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  PORT: "3010",
  PGHOST: "127.0.0.1",
  PGPORT: "55432",
  PGDATABASE: "camping_drive_stage9_test",
  PGUSER: "camping_drive_stage9",
  PGPASSWORD: "stage9-local-test-password",
  UPLOADS_DIR: path.resolve(".stage9/uploads"),
  ADMIN_SESSION_TTL_HOURS: "1",
  TRUST_PROXY_HOPS: "0",
};

export const stage9Administrator = {
  login: "stage9-admin",
  password: "Stage9-local-test-password",
} as const;

export function applyStage9Environment(): void {
  for (const [name, value] of Object.entries(stage9Environment)) {
    if (value !== undefined) process.env[name] = value;
  }
}
