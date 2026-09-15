import { readFile } from "node:fs/promises";
import * as yauzl from "yauzl-promise";
import { SaxesParser } from "saxes";
import { fileRevision } from "./contracts.js";

export interface XmlNode {
  name: string;
  uri: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
  start: number;
  openEnd: number;
  end: number;
}
export function parseXml(xml: string): XmlNode {
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  parser.on("doctype", () => {
    throw new Error("unsafe_xml: DTD declarations are not allowed");
  });
  parser.on("opentag", (tag) => {
    const end = parser.position;
    const node: XmlNode = {
      name: tag.local,
      uri: tag.uri,
      attrs: Object.fromEntries(
        Object.values(tag.attributes).map((a) => [a.name, a.value]),
      ),
      children: [],
      text: "",
      start: xml.lastIndexOf("<", end - 1),
      openEnd: end,
      end,
    };
    if (stack.length) stack.at(-1)!.children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on("text", (text) => {
    if (stack.length) stack.at(-1)!.text += text;
  });
  parser.on("cdata", (text) => {
    if (stack.length) stack.at(-1)!.text += text;
  });
  parser.on("closetag", () => {
    stack.pop()!.end = parser.position;
  });
  parser.write(xml).close();
  if (!root) throw new Error("invalid_xml: empty document");
  return root;
}
export const CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
export function children(node: XmlNode, name: string, uri = node.uri) {
  return node.children.filter((n) => n.name === name && n.uri === uri);
}
export function child(node: XmlNode, name: string) {
  const found = children(node, name);
  if (found.length !== 1)
    throw new Error(`invalid_project: expected one ${name}`);
  return found[0];
}
export interface ArchiveLimits {
  total: number;
  entry: number;
}
export function archiveLimits(): ArchiveLimits {
  const value = (key: string, fallback: number) => {
    const n = Number(process.env[key] ?? fallback);
    if (!Number.isSafeInteger(n) || n <= 0)
      throw new Error("invalid_limits: expected positive byte limit");
    return n;
  };
  return {
    total: value("PRUSAMCP_3MF_MAX_TOTAL_BYTES", 1024 ** 3),
    entry: value("PRUSAMCP_3MF_MAX_ENTRY_BYTES", 512 * 1024 ** 2),
  };
}
export async function readArchive(path: string, limits = archiveLimits()) {
  const bytes = await readFile(path);
  const revision = fileRevision(bytes);
  const zip = await yauzl.fromBuffer(bytes);
  const entries = new Map<string, Buffer>();
  let total = 0;
  try {
    const all = await zip.readEntries();
    for (const entry of all) {
      total += entry.uncompressedSize;
      if (entry.uncompressedSize > limits.entry || total > limits.total)
        throw new Error("archive_limit: uncompressed size limit exceeded");
      if (entries.has(entry.filename))
        throw new Error("invalid_archive: duplicate entry");
      entries.set(entry.filename, Buffer.alloc(0));
    }
    let actualTotal = 0;
    for (const entry of all) {
      const stream = await entry.openReadStream();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        actualTotal += chunk.length;
        if (size > limits.entry || actualTotal > limits.total) {
          stream.destroy();
          throw new Error("archive_limit: uncompressed size limit exceeded");
        }
        chunks.push(chunk);
      }
      entries.set(entry.filename, Buffer.concat(chunks));
    }
  } finally {
    await zip.close();
  }
  return { entries, revision, bytes };
}
export type ProjectArchive = Awaited<ReturnType<typeof readArchive>>;
export function xmlEntry(archive: ProjectArchive, path: string) {
  const data = archive.entries.get(path);
  if (!data) throw new Error("missing_reference: package part is absent");
  return parseXml(data.toString("utf8"));
}
