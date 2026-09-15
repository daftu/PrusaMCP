import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entries, model, writeFixture } from "./project-fixtures.js";
import { readArchive } from "../build/project-archive.js";
import { readProjectGeometry } from "../build/project-model.js";
import { writeProjectCopy } from "../build/project-writer.js";
test("no-op preserves every payload, rename patches one attribute, source unchanged", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "3mf-copy-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = await writeFixture(
    join(dir, "source.3mf"),
    entries(model(), { "Metadata/unknown.bin": Buffer.from([0, 255, 1, 5]) }),
  );
  const before = await readFile(source),
    a = await readArchive(source);
  await writeProjectCopy(source, a.revision, [], join(dir, "noop.3mf"));
  const noop = await readArchive(join(dir, "noop.3mf"));
  assert.deepEqual(noop.entries, a.entries);
  await writeProjectCopy(
    source,
    a.revision,
    [{ operation: "rename_object", object_id: "object:1", name: 'A & "B"' }],
    join(dir, "rename.3mf"),
  );
  const renamed = await readArchive(join(dir, "rename.3mf"));
  for (const [name, value] of a.entries)
    assert.deepEqual(
      renamed.entries.get(name),
      name === "3D/main.model"
        ? Buffer.from(
            value
              .toString()
              .replace('name="Original"', 'name="A &amp; &quot;B&quot;"'),
          )
        : value,
    );
  assert.deepEqual(await readFile(source), before);
  assert.equal(
    (await readProjectGeometry(join(dir, "rename.3mf"))).objects[0].name,
    'A & "B"',
  );
});
test("stale revision and output collisions are rejected; transform is read back", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "3mf-copy-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = await writeFixture(join(dir, "source.3mf"));
  const a = await readArchive(source);
  await assert.rejects(
    writeProjectCopy(
      source,
      { kind: "file", sha256: "0".repeat(64) },
      [],
      join(dir, "bad.3mf"),
    ),
    /stale_revision/,
  );
  await assert.rejects(
    writeProjectCopy(source, a.revision, [], source),
    /output_exists/,
  );
  const output = join(dir, "move.3mf");
  await writeProjectCopy(
    source,
    a.revision,
    [
      {
        operation: "transform_instance",
        instance_id: "instance:0",
        transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 20, 0],
      },
    ],
    output,
  );
  assert.deepEqual(
    (await readProjectGeometry(output)).instances[0].bounding_box.min,
    { x: 10, y: 20, z: 0 },
  );
  await assert.rejects(
    writeProjectCopy(source, a.revision, [], output),
    /output_exists/,
  );
});
test("dependent opaque payload prevents unsupported changes of basis", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "3mf-copy-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = await writeFixture(
    join(dir, "source.3mf"),
    entries(model(), { "Metadata/Slic3r_PE_sla_support_points.txt": "opaque" }),
  );
  const a = await readArchive(source);
  await assert.rejects(
    writeProjectCopy(
      source,
      a.revision,
      [
        {
          operation: "transform_instance",
          instance_id: "instance:0",
          transform: [2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0],
        },
      ],
      join(dir, "scaled.3mf"),
    ),
    /unsupported_patch/,
  );
});
test("stock 2.9.6 metadata rename and instance translation preserve opaque entries", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "3mf-native-copy-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const data = JSON.parse(
    await readFile(
      new URL("./fixtures/native-2.9.6-project.json", import.meta.url),
      "utf8",
    ),
  );
  const source = await writeFixture(join(dir, "source.3mf"), data);
  const a = await readArchive(source);
  const output = join(dir, "copy.3mf");
  const s = await readProjectGeometry(source);
  const moved = [...s.instances[0].transform];
  moved[9] += 10;
  await writeProjectCopy(
    source,
    a.revision,
    [
      {
        operation: "rename_object",
        object_id: "object:1",
        name: "Renamed fixture",
      },
      {
        operation: "transform_instance",
        instance_id: "instance:0",
        transform: moved,
      },
    ],
    output,
  );
  const b = await readArchive(output);
  assert.deepEqual(
    b.entries.get("Metadata/Slic3r_PE_layer_heights_profile.txt"),
    a.entries.get("Metadata/Slic3r_PE_layer_heights_profile.txt"),
  );
  assert.equal(
    (await readProjectGeometry(output)).instances[0].bounding_box.min.x,
    s.instances[0].bounding_box.min.x + 10,
  );
  const before = a.entries.get("Metadata/Slic3r_PE_model.config").toString(),
    after = b.entries.get("Metadata/Slic3r_PE_model.config").toString();
  assert.equal(
    after,
    before.replace(
      'key="name" value="cube.stl"',
      'key="name" value="Renamed fixture"',
    ),
  );
});
