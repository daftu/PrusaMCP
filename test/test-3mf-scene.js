import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entries, model, mesh, writeFixture } from "./project-fixtures.js";
import { readProjectGeometry } from "../build/project-model.js";
import { parse3mf } from "../build/threemf-parser.js";
import { readArchive } from "../build/project-archive.js";
async function fixture(t, xml, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), "3mf-scene-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return writeFixture(join(dir, "scene.3mf"), entries(xml, extra));
}
test("local indices remain local, only build instances are flattened", async (t) => {
  const p = await fixture(
    t,
    model(
      `<object id="1">${mesh}</object><object id="2">${mesh}</object><object id="3">${mesh}</object>`,
      '<item objectid="1"/><item transform="1 0 0 0 1 0 0 0 1 10 0 0" objectid="2"/>',
    ),
  );
  const scene = await readProjectGeometry(p);
  assert.equal(scene.objects.length, 3);
  assert.equal(scene.instances.length, 2);
  assert.equal(scene.instances[1].bounding_box.min.x, 10);
  const flat = await parse3mf(p);
  assert.equal(flat.triangles.length, 8);
  assert.equal(flat.triangles[4].v1.x, 10);
  assert.equal(scene.objects[0].volumes[0].volume_id, "object:1/volume:0");
});
test("component and instance transforms compose before unit conversion", async (t) => {
  const p = await fixture(
    t,
    model(
      `<object id="1">${mesh}</object><object id="2"><components><component transform="0 1 0 -1 0 0 0 0 1 2 3 0" objectid="1"/></components></object>`,
      '<item objectid="2" transform="1 0 0 0 1 0 0 0 1 10 0 0"/>',
      'unit="centimeter"',
    ),
  );
  const scene = await readProjectGeometry(p);
  assert.deepEqual(scene.instances[0].bounding_box, {
    min: { x: 110, y: 30, z: 0 },
    max: { x: 120, y: 40, z: 10 },
  });
});
test("missing, external, cyclic and required extension geometry fail instead of claiming complete", async (t) => {
  for (const xml of [
    model(undefined, '<item objectid="9"/>'),
    model(
      '<object id="1"><components><component objectid="1"/></components></object>',
    ),
    model(
      undefined,
      '<item objectid="1" p:path="/other.model"/>',
      'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"',
    ),
    model(
      undefined,
      undefined,
      'xmlns:x="urn:geometry" requiredextensions="x"',
    ),
  ])
    await assert.rejects(readProjectGeometry(await fixture(t, xml)));
});
test("rejects DTD and enforces total and single-entry uncompressed limits", async (t) => {
  const p = await fixture(t, model());
  await assert.rejects(
    readArchive(p, { entry: 10, total: 10000 }),
    /archive_limit/,
  );
  await assert.rejects(
    readArchive(p, { entry: 10000, total: 10 }),
    /archive_limit/,
  );
  await assert.rejects(
    readProjectGeometry(
      await fixture(
        t,
        model().replace(
          '<?xml version="1.0"?>',
          '<!DOCTYPE model [<!ENTITY x SYSTEM "file:///etc/passwd">]>',
        ),
      ),
    ),
    /unsafe_xml/,
  );
});
test("nonprintable instance does not enter legacy mesh analysis", async (t) => {
  const p = await fixture(
    t,
    model(undefined, '<item objectid="1" printable="false"/>'),
  );
  assert.equal((await parse3mf(p)).triangles.length, 0);
});
