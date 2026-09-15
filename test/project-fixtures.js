import { ZipFile } from "yazl";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
export const core = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
export const mesh =
  '<mesh><vertices><vertex z="0" y="0" x="0"/><vertex x="1" z="0" y="0"/><vertex y="1" x="0" z="0"/><vertex z="1" x="0" y="0"/></vertices><triangles><triangle v3="1" v1="0" v2="2"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh>';
export function model(
  resources = `<object id="1" name="Original">${mesh}</object>`,
  build = '<item objectid="1"/>',
  attrs = "",
) {
  return `<?xml version="1.0"?><model xmlns="${core}" ${attrs}><resources>${resources}</resources><build>${build}</build></model>`;
}
export function entries(xml = model(), extras = {}) {
  return {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/main.model" Id="r0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    "3D/main.model": xml,
    ...extras,
  };
}
export async function writeFixture(path, data = entries()) {
  const zip = new ZipFile();
  const done = pipeline(zip.outputStream, createWriteStream(path));
  for (const [name, value] of Object.entries(data))
    zip.addBuffer(Buffer.from(value), name);
  zip.end();
  await done;
  return path;
}
