import { access, mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";

export async function ensureUploadsDirectory(uploadsDir: string): Promise<void> {
  await mkdir(uploadsDir, { recursive: true });

  if (path.basename(uploadsDir) !== "current") return;

  const storageRoot = path.dirname(uploadsDir);
  const entries = await readdir(storageRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === "current" ||
      entry.name.startsWith(".restore-") ||
      entry.name.startsWith("previous-")
    ) {
      continue;
    }

    const source = path.join(storageRoot, entry.name);
    const destination = path.join(uploadsDir, entry.name);
    try {
      await access(destination);
    } catch {
      await rename(source, destination);
      continue;
    }
    throw new Error(`Cannot migrate legacy upload path because ${destination} already exists`);
  }
}
