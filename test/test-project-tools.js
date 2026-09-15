import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProjectTools } from "../build/tools/projects.js";
import { writeFixture } from "./project-fixtures.js";
test("project tools enforce schemas, return file revisions and share native resolver", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "3mf-tools-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = await writeFixture(join(dir, "source.3mf"));
  const tools = new Map();
  let resolved;
  registerProjectTools(
    {
      registerTool(name, options, callback) {
        tools.set(name, { options, callback });
      },
    },
    {
      async resolveFile(path) {
        resolved = path;
        return {
          snapshot_id: "native-snapshot",
          revision: { kind: "file", sha256: "1".repeat(64) },
          settings: { layer_height: "0.2" },
        };
      },
    },
  );
  async function call(name, args) {
    const tool = tools.get(name);
    const response = await tool.callback(
      z.object(tool.options.inputSchema).parse(args),
    );
    tool.options.outputSchema.parse(response.structuredContent);
    assert.deepEqual(
      JSON.parse(response.content[0].text),
      response.structuredContent,
    );
    return response;
  }
  const scene = (await call("read_project_geometry", { path: source }))
    .structuredContent;
  assert.equal(scene.source, "file");
  assert.equal(scene.status, "confirmed");
  const meta = (
    await call("read_project_metadata", {
      path: source,
      resolve_effective: true,
    })
  ).structuredContent;
  assert.equal(resolved, source);
  assert.equal(
    meta.data.effective_configuration.snapshot_id,
    "native-snapshot",
  );
  const output = join(dir, "copy.3mf");
  const written = (
    await call("write_project_copy", {
      source,
      expected_revision: scene.revision,
      supported_patch: [],
      output,
    })
  ).structuredContent;
  assert.equal(written.data.native_validated, false);
  const failed = await call("write_project_copy", {
    source,
    expected_revision: scene.revision,
    supported_patch: [],
    output,
  });
  assert.equal(failed.isError, true);
  assert.equal(failed.structuredContent.error.code, "output_exists");
  assert.equal(
    tools.get("write_project_copy").options.annotations.readOnlyHint,
    false,
  );
});
