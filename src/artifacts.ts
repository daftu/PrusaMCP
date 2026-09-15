import { link, lstat, mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

function outputExists(path: string): Error {
  return Object.assign(new Error(`output_exists: ${path}`), { code: "output_exists" });
}

/** Early collision check; publication still enforces no replacement atomically. */
export async function assertOutputAvailable(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw outputExists(path);
}

/** Keep staging on the destination filesystem so publication can use a hard link. */
export async function createArtifactStage(outputPath: string): Promise<{ directory: string; path: string }> {
  const destination = resolve(outputPath);
  const directory = await mkdtemp(join(dirname(destination), ".prusamcp-"));
  return { directory, path: join(directory, basename(destination)) };
}

/** Expose a complete file in one operation, refusing even a concurrent collision. */
export async function publishArtifact(stagingPath: string, outputPath: string): Promise<void> {
  try {
    await link(stagingPath, outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw outputExists(outputPath);
    throw error;
  }
}

export async function removeArtifactStage(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}
