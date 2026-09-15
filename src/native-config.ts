import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const nativeProfileSchema = z.object({ kind: z.enum(["printer", "print", "filament", "sla_print", "sla_material"]), name: z.string(), settings: z.record(z.string()) });
const selectionSchema = z.object({ printer: z.string(), print: z.string(), materials: z.array(z.string()) });
const resultSchema = z.object({ protocol: z.literal(1), version: z.literal("2.9.6"), profiles: z.array(nativeProfileSchema),
  substitutions: z.array(z.object({ kind: z.string(), name: z.string(), key: z.string() })), omitted_fields: z.array(z.string()),
  selection: selectionSchema.optional(), technology: z.enum(["FFF", "SLA"]).optional() });
export type NativeProfile = z.infer<typeof nativeProfileSchema>;
export interface NativeConfigRequest {
  operation: "import" | "resolve"; datadir: string; bundle_path?: string; output_bundle_path: string;
  output_flat_path?: string; overrides_path?: string; selection?: z.infer<typeof selectionSchema>;
}
/** The helper is built from pinned upstream sources; never load private app symbols. */
export async function nativeConfiguration(request: NativeConfigRequest, temporary: string) {
  const executable = process.env.PRUSAMCP_NATIVE_CONFIG_PATH;
  if (!executable) throw new Error("native_backend_missing: configure PRUSAMCP_NATIVE_CONFIG_PATH for bundle operations");
  const input = join(temporary, "request.json");
  await writeFile(input, JSON.stringify(request), { mode: 0o600 });
  const execution = await new Promise<{ failed: boolean; stdout: string }>(resolve => {
    execFile(executable, [input], { cwd: temporary, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" }, (error, stdout) => resolve({ failed: Boolean(error), stdout }));
  });
  if (execution.failed) {
    let code = "native_configuration_rejected";
    try {
      const failure = z.object({protocol: z.literal(1), version: z.literal("2.9.6"), error: z.enum(["native_configuration_rejected", "incompatible_preset", "unknown_preset", "invalid_selection"])}).parse(JSON.parse(execution.stdout));
      code = failure.error;
    } catch { /* Native diagnostics and process errors can contain private values. */ }
    throw new Error(`${code}: native bundle operation failed`);
  }
  let result: z.infer<typeof resultSchema>;
  try { result = resultSchema.parse(JSON.parse(execution.stdout)); }
  catch { throw new Error("invalid_native_response: native helper response is invalid"); }
  // A successful process without fresh, nonempty artifacts is not a completed operation.
  for (const path of [request.output_bundle_path, ...(request.output_flat_path ? [request.output_flat_path] : [])]) {
    if (!(await readFile(path)).length) throw new Error("native_artifact_missing: native helper did not produce a configuration");
  }
  return result;
}
