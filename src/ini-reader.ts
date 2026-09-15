/** INI values remain in PrusaSlicer's native serialization (including escaped newlines).
 * Only the first equals sign separates key and value; semicolons in values are data.
 */
export interface IniSection { name: string; settings: Record<string, string> }
export interface IniDocument { format: "flat_ini" | "bundle"; settings: Record<string, string>; sections: IniSection[] }

export function readIni(text: string): IniDocument {
  const settings: Record<string, string> = {};
  const sections: IniSection[] = [];
  let current = settings;
  for (const [index, raw] of text.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      const entry = { name: section[1], settings: {} as Record<string, string> };
      sections.push(entry);
      current = entry.settings;
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`invalid_ini: expected key=value on line ${index + 1}`);
    current[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { format: sections.length ? "bundle" : "flat_ini", settings, sections };
}

export function serializeNativeSettings(settings: Record<string, string>): string {
  return Object.keys(settings).sort().map(key => `${key} = ${settings[key]}\n`).join("");
}

// These native configuration keys contain host credentials, host connection details,
// or executable host scripts. Keep their names in omission reports, never their values.
export function omitPrivateSettings(settings: Record<string, string>) {
  const safe: Record<string, string> = {};
  const omitted_fields: string[] = [];
  for (const [key, value] of Object.entries(settings)) {
    if (key === "post_process" || key.startsWith("printhost_") || key === "print_host" || key === "physical_printer_settings_id") {
      omitted_fields.push(key);
    } else safe[key] = value;
  }
  return { settings: safe, omitted_fields: omitted_fields.sort() };
}
