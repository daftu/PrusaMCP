import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { z } from "zod";
import { fileRevision } from "./contracts.js";
import {
  assertOutputAvailable,
  createArtifactStage,
  publishArtifact,
  removeArtifactStage,
} from "./artifacts.js";
import {
  readArchive,
  children,
  xmlEntry,
  type XmlNode,
} from "./project-archive.js";
import { sceneFromArchive } from "./project-model.js";
import { MODEL_CONFIG, metadataFromArchive } from "./project-metadata.js";
export const matrixSchema = z.array(z.number().finite()).length(12);
export const projectPatchSchema = z.array(
  z.discriminatedUnion("operation", [
    z
      .object({
        operation: z.literal("rename_object"),
        object_id: z.string(),
        name: z.string().min(1),
      })
      .strict(),
    z
      .object({
        operation: z.literal("transform_instance"),
        instance_id: z.string(),
        transform: matrixSchema,
      })
      .strict(),
  ]),
);
export type ProjectPatch = z.infer<typeof projectPatchSchema>;
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;")
    .replace(/\t/g, "&#9;");
/** Locate a lexical attribute only inside the element already identified by the XML parser. */
function attributeEdit(xml: string, node: XmlNode, key: string, value: string) {
  const tag = xml.slice(node.start, node.openEnd);
  const pattern = /([^\s=<>/]+)\s*=\s*("[^"]*"|'[^']*')/g;
  let match;
  while ((match = pattern.exec(tag)))
    if (match[1] === key) {
      const quoted = match[2];
      const start = node.start + match.index + match[0].lastIndexOf(quoted) + 1;
      return { start, end: start + quoted.length - 2, value: escape(value) };
    }
  const end = node.openEnd - (tag.endsWith("/>") ? 2 : 1);
  return { start: end, end, value: ` ${key}="${escape(value)}"` };
}
export async function writeProjectCopy(
  source: string,
  expected_revision: ReturnType<typeof fileRevision>,
  supported_patch: ProjectPatch,
  output: string,
) {
  const patch = projectPatchSchema.parse(supported_patch);
  await assertOutputAvailable(output);
  const archive = await readArchive(source);
  if (
    expected_revision.kind !== "file" ||
    archive.revision.sha256 !== expected_revision.sha256
  )
    throw new Error("stale_revision: source content changed");
  const { scene, root, nodeMap, buildNodes } = sceneFromArchive(archive);
  const metadata = metadataFromArchive(archive);
  const edits = new Map<string, ReturnType<typeof attributeEdit>[]>();
  const changed_fields: { target_id: string; field: string }[] = [];
  const seen = new Set<string>();
  const edit = (path: string, node: XmlNode, key: string, value: string) => {
    const list = edits.get(path) ?? [];
    list.push(
      attributeEdit(
        archive.entries.get(path)!.toString("utf8"),
        node,
        key,
        value,
      ),
    );
    edits.set(path, list);
  };
  for (const change of patch) {
    const id =
      change.operation === "rename_object"
        ? change.object_id
        : change.instance_id;
    if (seen.has(`${change.operation}:${id}`))
      throw new Error("invalid_patch: duplicate target");
    seen.add(`${change.operation}:${id}`);
    if (
      metadata.format_version !== null &&
      !["1", "2"].includes(metadata.format_version)
    )
      throw new Error("unsupported_patch: unrecognized Prusa project version");
    if (change.operation === "rename_object") {
      const node = nodeMap.get(id);
      if (!node) throw new Error("unknown_target: object id absent");
      if (archive.entries.has(MODEL_CONFIG)) {
        const config = xmlEntry(archive, MODEL_CONFIG);
        const obj = children(config, "object").find(
          (n) => n.attrs.id === node.attrs.id,
        );
        const name =
          obj &&
          children(obj, "metadata").find(
            (n) => n.attrs.type === "object" && n.attrs.key === "name",
          );
        if (!name)
          throw new Error(
            "unsupported_patch: native object name field is absent",
          );
        edit(MODEL_CONFIG, name, "value", change.name);
      } else edit(scene.model_path, node, "name", change.name);
      changed_fields.push({ target_id: id, field: "name" });
    } else {
      const index = scene.instances.findIndex((i) => i.instance_id === id);
      if (index < 0) throw new Error("unknown_target: instance id absent");
      // Native auxiliary data are retained verbatim. This first writer only moves their
      // instance origin; changes of basis can require native regeneration of that data.
      if (
        metadata.opaque.length &&
        change.transform
          .slice(0, 9)
          .some((v, i) => v !== scene.instances[index].transform[i])
      )
        throw new Error(
          "unsupported_patch: dependent opaque data require native transformation",
        );
      const unknownParts = [...archive.entries.keys()].filter(
        (p) =>
          !p.endsWith("/") &&
          ![
            "_rels/.rels",
            "[Content_Types].xml",
            scene.model_path,
            MODEL_CONFIG,
            "Metadata/Slic3r_PE.config",
            "Metadata/Prusa_Slicer_wipe_tower_information.xml",
          ].includes(p) &&
          !/^Metadata\/(thumbnail.*\.png|Slic3r_PE_layer_heights_profile.txt|Slic3r_PE_sla_support_points.txt|Slic3r_PE_sla_drain_holes.txt)$/.test(
            p,
          ),
      );
      if (unknownParts.length)
        throw new Error("unsupported_patch: unknown dependent package parts");
      if (root.children.some((n) => n.uri !== root.uri))
        throw new Error("unsupported_patch: unknown model extension");
      edit(
        scene.model_path,
        buildNodes[index],
        "transform",
        change.transform.join(" "),
      );
      changed_fields.push({ target_id: id, field: "transform" });
    }
  }
  for (const [path, list] of edits) {
    let text = archive.entries.get(path)!.toString("utf8");
    for (const e of list.sort((a, b) => b.start - a.start))
      text = text.slice(0, e.start) + e.value + text.slice(e.end);
    archive.entries.set(path, Buffer.from(text));
  }
  const stage = await createArtifactStage(output);
  try {
    const zip = new ZipFile();
    const completed = pipeline(
      zip.outputStream,
      createWriteStream(stage.path, { flags: "wx" }),
    );
    for (const [name, data] of archive.entries)
      if (name.endsWith("/")) zip.addEmptyDirectory(name);
      else zip.addBuffer(data, name);
    zip.end();
    await completed;
    // Verify syntax/semantic readback before exposing the artifact and repeat source check.
    const written = await readArchive(stage.path);
    sceneFromArchive(written);
    metadataFromArchive(written);
    if (
      fileRevision(await readFile(source)).sha256 !== expected_revision.sha256
    )
      throw new Error("stale_revision: source changed before publication");
    await publishArtifact(stage.path, output);
    return {
      revision: written.revision,
      source_revision: archive.revision,
      artifact: {
        path: output,
        media_type: "model/3mf",
        revision: written.revision,
      },
      changed_fields,
      native_validated: false as const,
    };
  } finally {
    await removeArtifactStage(stage.directory);
  }
}
