import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";

import { createApp } from "./app.js";
import { config } from "./config.js";
import { database } from "./database.js";
import { startImageDeletionWorker } from "./routes/images.js";
import { ensureUploadsDirectory } from "./uploads.js";

await ensureUploadsDirectory(config.uploadsDir);
await access(config.uploadsDir, fsConstants.W_OK);
const stopImageDeletionWorker = startImageDeletionWorker(database);

const app = createApp();

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Backend is listening on port ${config.port}`);
});

let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}; shutting down`);
  stopImageDeletionWorker();

  server.close(async (serverError) => {
    try {
      await database.end();
    } catch (databaseError) {
      console.error("Failed to close PostgreSQL pool", databaseError);
      process.exitCode = 1;
    }

    if (serverError) {
      console.error("Failed to close HTTP server", serverError);
      process.exitCode = 1;
    }
  });

  setTimeout(() => {
    console.error("Graceful shutdown timed out");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
