import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { request } from "node:https";
import { request as httpRequest } from "node:http";

function httpUpload(
  url: string,
  headers: Record<string, string>,
  body: Buffer,
  method: string = "POST",
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === "https:";
    const reqFn = isHttps ? request : httpRequest;

    const req = reqFn(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method,
        headers: {
          ...headers,
          "Content-Length": body.length.toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export function registerUploadPrint(server: McpServer) {
  server.registerTool(
    "upload_print",
    {
      title: "Envoyer un G-code à l'imprimante",
      description:
        "Upload un fichier G-code vers OctoPrint ou PrusaConnect pour lancer l'impression. " +
        "Nécessite l'URL du serveur et une API key.",
      inputSchema: {
        gcode_path: z.string().describe("Chemin du fichier G-code à envoyer"),
        server_type: z
          .enum(["octoprint", "prusaconnect"])
          .describe("Type de serveur d'impression"),
        server_url: z
          .string()
          .describe("URL du serveur (ex: http://192.168.1.100:5000 pour OctoPrint)"),
        api_key: z.string().describe("Clé API pour l'authentification"),
        start_print: z
          .boolean()
          .default(false)
          .describe("Lancer l'impression immédiatement après l'upload"),
      },
    },
    async ({ gcode_path, server_type, server_url, api_key, start_print }) => {
      try {
        if (!existsSync(gcode_path)) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Fichier non trouvé : ${gcode_path}` }],
          };
        }

        const fileContent = await readFile(gcode_path);
        const fileName = basename(gcode_path);
        const baseUrl = server_url.replace(/\/$/, "");

        if (server_type === "octoprint") {
          return await uploadToOctoPrint(baseUrl, api_key, fileName, fileContent, start_print);
        } else {
          return await uploadToPrusaConnect(baseUrl, api_key, fileName, fileContent, start_print);
        }
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Erreur d'upload : ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}

async function uploadToOctoPrint(
  baseUrl: string,
  apiKey: string,
  fileName: string,
  fileContent: Buffer,
  startPrint: boolean,
) {
  // OctoPrint uses multipart/form-data
  const boundary = `----PrusaMCP${Date.now()}`;
  const parts: Buffer[] = [];

  // File part
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`,
  ));
  parts.push(fileContent);
  parts.push(Buffer.from("\r\n"));

  // Print option
  if (startPrint) {
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="print"\r\n\r\ntrue\r\n`,
    ));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const result = await httpUpload(
    `${baseUrl}/api/files/local`,
    {
      "X-Api-Key": apiKey,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  );

  if (result.status >= 200 && result.status < 300) {
    return {
      content: [{
        type: "text" as const,
        text: [
          `## Upload OctoPrint réussi`,
          `**Fichier** : ${fileName}`,
          `**Serveur** : ${baseUrl}`,
          startPrint ? `**Impression lancée**` : `**En attente** — lance l'impression depuis l'interface OctoPrint`,
        ].join("\n"),
      }],
    };
  }

  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: `Upload échoué (HTTP ${result.status}) : ${result.body}`,
    }],
  };
}

async function uploadToPrusaConnect(
  baseUrl: string,
  apiKey: string,
  fileName: string,
  fileContent: Buffer,
  _startPrint: boolean,
) {
  // PrusaConnect uses PUT with raw file content
  const result = await httpUpload(
    `${baseUrl}/api/v1/files/sdcard/${fileName}`,
    {
      "X-Api-Key": apiKey,
      "Content-Type": "application/octet-stream",
    },
    fileContent,
    "PUT",
  );

  if (result.status >= 200 && result.status < 300) {
    return {
      content: [{
        type: "text" as const,
        text: [
          `## Upload PrusaConnect réussi`,
          `**Fichier** : ${fileName}`,
          `**Serveur** : ${baseUrl}`,
          `Lance l'impression depuis l'interface PrusaConnect.`,
        ].join("\n"),
      }],
    };
  }

  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: `Upload échoué (HTTP ${result.status}) : ${result.body}`,
    }],
  };
}
