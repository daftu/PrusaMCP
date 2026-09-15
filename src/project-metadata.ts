import {
  children,
  readArchive,
  xmlEntry,
  type ProjectArchive,
  type XmlNode,
} from "./project-archive.js";
import { sceneFromArchive } from "./project-model.js";
import { omitPrivateSettings, readIni } from "./ini-reader.js";
import type { ConfigurationService } from "./config-resolver.js";
import type { SettingAddress } from "./contracts.js";
export const MODEL_CONFIG = "Metadata/Slic3r_PE_model.config";
export function metadataValues(node: XmlNode) {
  return Object.fromEntries(
    children(node, "metadata")
      .filter((n) => n.attrs.key !== undefined)
      .map((n) => [n.attrs.key, n.attrs.value ?? n.text]),
  );
}
export function metadataFromArchive(archive: ProjectArchive) {
  const { scene, root } = sceneFromArchive(archive);
  const config = archive.entries.has(MODEL_CONFIG)
    ? xmlEntry(archive, MODEL_CONFIG)
    : undefined;
  const version =
    children(root, "metadata").find(
      (n) => n.attrs.name === "slic3rpe:Version3mf",
    )?.text ?? null;
  const stored: {
    address: SettingAddress;
    value: string;
    effective_known: false;
    effective_value: null;
  }[] = [];
  const omitted_fields: string[] = [];
  const add = (
    values: Record<string, string>,
    scope: "global" | "object" | "volume",
    target_id?: string,
  ) => {
    const safe = omitPrivateSettings(values);
    omitted_fields.push(...safe.omitted_fields);
    for (const [key, value] of Object.entries(safe.settings))
      stored.push({
        address:
          scope === "global"
            ? { scope, key }
            : { scope, key, target_id: target_id! },
        value,
        effective_known: false,
        effective_value: null,
      });
  };
  const global = archive.entries.get("Metadata/Slic3r_PE.config");
  if (global)
    add(
      readIni(
        global.toString("utf8").replace(/^; ?(?=[a-z][a-z0-9_]*\s*=)/gm, ""),
      ).settings,
      "global",
    );
  const objects = scene.objects.map((obj) => {
    const node =
      config &&
      children(config, "object").find((n) => n.attrs.id === obj.resource_id);
    const values = node ? metadataValues(node) : {};
    const { name, ...overrides } = values;
    add(overrides, "object", obj.object_id);
    const volumes = (node ? children(node, "volume") : []).map((v, index) => {
      const raw = metadataValues(v);
      const role =
        raw.volume_type ??
        (raw.modifier === "1" ? "ParameterModifier" : "ModelPart");
      const first = Number(v.attrs.firstid),
        last = Number(v.attrs.lastid);
      if (
        !Number.isInteger(first) ||
        !Number.isInteger(last) ||
        first < 0 ||
        last < first ||
        last >= obj.triangles.length
      )
        throw new Error("invalid_metadata: volume triangle range is invalid");
      const id = `${obj.object_id}/volume:${index}`;
      const settingValues = Object.fromEntries(
        Object.entries(raw).filter(
          ([k]) =>
            !["name", "volume_type", "modifier", "matrix"].includes(k) &&
            !k.startsWith("source_"),
        ),
      );
      add(settingValues, "volume", id);
      return {
        volume_id: id,
        first_triangle: first,
        last_triangle: last,
        name: raw.name ?? "",
        role,
        extruder_index:
          raw.extruder && Number(raw.extruder) > 0
            ? Number(raw.extruder) - 1
            : null,
        stored_matrix: (raw.matrix ?? null) as string | null,
      };
    });
    if (!volumes.length && obj.triangles.length)
      volumes.push({
        volume_id: `${obj.object_id}/volume:0`,
        first_triangle: 0,
        last_triangle: obj.triangles.length - 1,
        name: obj.name,
        role: "ModelPart",
        extruder_index: null,
        stored_matrix: null,
      });
    return {
      object_id: obj.object_id,
      name: name ?? obj.name,
      extruder_index:
        values.extruder && Number(values.extruder) > 0
          ? Number(values.extruder) - 1
          : null,
      volumes,
    };
  });
  const opaque: {
    kind: string;
    entry: string;
    object_id?: string;
    coverage: "partial";
  }[] = [];
  for (const name of archive.entries.keys()) {
    const kind = /layer_heights|layer_config_ranges/.test(name)
      ? "variable_layers"
      : /sla_/.test(name)
        ? "sla"
        : /\.svg$/i.test(name)
          ? "svg"
          : null;
    if (kind) opaque.push({ kind, entry: name, coverage: "partial" });
  }
  const walk = (node: XmlNode, entry: string, object_id?: string) => {
    const id =
      node.name === "object" && node.attrs.id
        ? `object:${node.attrs.id}`
        : object_id;
    if (
      Object.keys(node.attrs).some((k) =>
        /:(custom_supports|custom_seam|mmu_segmentation|fuzzy_skin)$/.test(k),
      )
    )
      opaque.push({
        kind: "painting",
        entry,
        ...(id ? { object_id: id } : {}),
        coverage: "partial",
      });
    if (["text", "shape"].includes(node.name))
      opaque.push({
        kind: node.name === "text" ? "text" : "svg",
        entry,
        ...(id ? { object_id: id } : {}),
        coverage: "partial",
      });
    for (const c of node.children) walk(c, entry, id);
  };
  walk(root, scene.model_path);
  if (config) walk(config, MODEL_CONFIG);
  return {
    revision: archive.revision,
    format_version: version,
    objects,
    instances: scene.instances.map(({ instance_id, object_id, printable }) => ({
      instance_id,
      object_id,
      printable,
    })),
    stored_overrides: stored,
    omitted_fields: [...new Set(omitted_fields)],
    opaque: opaque.filter(
      (x, i, a) =>
        a.findIndex((y) => JSON.stringify(y) === JSON.stringify(x)) === i,
    ),
    effective_configuration: null as {
      snapshot_id: string;
      revision: unknown;
      settings: Record<string, string>;
    } | null,
    coverage:
      opaque.length || (version !== null && !["1", "2"].includes(version))
        ? ("partial" as const)
        : ("complete" as const),
  };
}
export async function readProjectMetadata(
  path: string,
  service?: ConfigurationService,
) {
  const result = metadataFromArchive(await readArchive(path));
  if (service) {
    const snapshot = await service.resolveFile(path);
    const fresh = await readArchive(path);
    if (fresh.revision.sha256 !== result.revision.sha256)
      throw new Error(
        "stale_revision: source changed during configuration resolution",
      );
    result.effective_configuration = {
      snapshot_id: snapshot.snapshot_id,
      revision: snapshot.revision,
      settings: snapshot.settings,
    };
  }
  return result;
}
