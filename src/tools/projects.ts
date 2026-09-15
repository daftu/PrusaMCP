import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  artifactRefSchema,
  revisionSchema,
  settingAddressSchema,
  toolResultObjectSchema,
  toolResultSchema,
} from "../contracts.js";
import { readProjectGeometry } from "../project-model.js";
import { readProjectMetadata } from "../project-metadata.js";
import {
  writeProjectCopy,
  matrixSchema,
  projectPatchSchema,
} from "../project-writer.js";
import type { ConfigurationService } from "../config-resolver.js";
const pointSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });
const volumeSchema = z.object({
  volume_id: z.string(),
  first_triangle: z.number().int(),
  last_triangle: z.number().int(),
  name: z.string(),
  role: z.string(),
  extruder_index: z.number().int().nonnegative().nullable(),
  stored_matrix: z.string().nullable(),
});
const geometrySchema = z.object({
  revision: revisionSchema,
  model_path: z.string(),
  unit: z.string(),
  objects: z.array(
    z.object({
      object_id: z.string(),
      resource_id: z.string(),
      name: z.string(),
      vertices: z.array(pointSchema),
      triangles: z.array(z.array(z.number().int()).length(3)),
      components: z.array(
        z.object({ object_id: z.string(), transform: matrixSchema }),
      ),
      volumes: z.array(volumeSchema),
    }),
  ),
  instances: z.array(
    z.object({
      instance_id: z.string(),
      object_id: z.string(),
      printable: z.boolean(),
      transform: matrixSchema,
      meshes: z.array(
        z.object({ object_id: z.string(), transform_mm: matrixSchema }),
      ),
      bounding_box: z.object({ min: pointSchema, max: pointSchema }).nullable(),
    }),
  ),
});
const metadataSchema = z.object({
  revision: revisionSchema,
  format_version: z.string().nullable(),
  coverage: z.enum(["complete", "partial"]),
  objects: z.array(
    z.object({
      object_id: z.string(),
      name: z.string(),
      extruder_index: z.number().int().nonnegative().nullable(),
      volumes: z.array(volumeSchema),
    }),
  ),
  instances: z.array(
    z.object({
      instance_id: z.string(),
      object_id: z.string(),
      printable: z.boolean(),
    }),
  ),
  stored_overrides: z.array(
    z.object({
      address: settingAddressSchema,
      value: z.string(),
      effective_known: z.literal(false),
      effective_value: z.null(),
    }),
  ),
  omitted_fields: z.array(z.string()),
  opaque: z.array(
    z.object({
      kind: z.string(),
      entry: z.string(),
      object_id: z.string().optional(),
      coverage: z.literal("partial"),
    }),
  ),
  effective_configuration: z
    .object({
      snapshot_id: z.string(),
      revision: revisionSchema,
      settings: z.record(z.string()),
    })
    .nullable(),
});
const writtenSchema = z.object({
  revision: revisionSchema,
  source_revision: revisionSchema,
  artifact: artifactRefSchema,
  changed_fields: z.array(
    z.object({ target_id: z.string(), field: z.string() }),
  ),
  native_validated: z.literal(false),
});
async function respond<D extends z.ZodTypeAny>(
  schema: D,
  operation: () => Promise<unknown>,
) {
  let result;
  try {
    const data = schema.parse(await operation());
    const partial = data.coverage === "partial";
    result = toolResultSchema(schema).parse({
      source: "file",
      revision: data.revision,
      coverage: partial ? "partial" : "complete",
      status: partial ? "partial" : "confirmed",
      warnings: partial
        ? ["Opaque payloads are preserved but not interpreted."]
        : [],
      summary: "Saved project operation completed.",
      data,
    });
  } catch (error) {
    const code =
      error instanceof Error
        ? (/^[a-z][a-z_]+:/.exec(error.message)?.[0].slice(0, -1) ??
          "project_failed")
        : "project_failed";
    result = toolResultSchema(schema).parse({
      source: "file",
      coverage: "unsupported",
      status: "failed",
      warnings: [],
      summary: `Project operation failed (${code}).`,
      data: null,
      error: { code, message: `Project operation failed (${code}).` },
    });
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
    ...(result.status === "failed" ? { isError: true } : {}),
  };
}
export function registerProjectTools(
  server: McpServer,
  configurations: ConfigurationService,
) {
  const read = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  server.registerTool(
    "read_project_geometry",
    {
      description:
        "Read saved 3MF resources, native volume ranges and build instances. Source vertices use the declared unit; flattened instance transforms and bounding boxes use millimeters. IDs are valid only in the returned content revision. Required extensions and cross-part geometry are rejected. Does not describe unsaved GUI or evaluate CSG.",
      inputSchema: { path: z.string() },
      outputSchema: toolResultObjectSchema(geometrySchema),
      annotations: read,
    },
    async ({ path }) =>
      respond(geometrySchema, () => readProjectGeometry(path)),
  );
  server.registerTool(
    "read_project_metadata",
    {
      description:
        "Read native saved project overrides, part roles, printability and zero-based extruder assignments. Opaque painting, variable layers, text/SVG and SLA payloads are reported without interpretation. Set resolve_effective to use the existing native configuration resolver for global effective settings; object/volume overrides remain stored values. Host secrets and scripts are omitted.",
      inputSchema: {
        path: z.string(),
        resolve_effective: z.boolean().default(false),
      },
      outputSchema: toolResultObjectSchema(metadataSchema),
      annotations: read,
    },
    async ({ path, resolve_effective }) =>
      respond(metadataSchema, () =>
        readProjectMetadata(
          path,
          resolve_effective ? configurations : undefined,
        ),
      ),
  );
  server.registerTool(
    "write_project_copy",
    {
      description:
        "Write a new 3MF copy with an expected source content revision. Patches only rename an object or change a build instance transform; dependent unknown metadata can prevent a transform. All unedited entry contents are preserved. Never replaces an existing file. Native slicer validation is not performed by this tool and native_validated remains false.",
      inputSchema: {
        source: z.string(),
        expected_revision: z.object({
          kind: z.literal("file"),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        }),
        supported_patch: projectPatchSchema,
        output: z.string(),
      },
      outputSchema: toolResultObjectSchema(writtenSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ source, expected_revision, supported_patch, output }) =>
      respond(writtenSchema, () =>
        writeProjectCopy(source, expected_revision, supported_patch, output),
      ),
  );
}
