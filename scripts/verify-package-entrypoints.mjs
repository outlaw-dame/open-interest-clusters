import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const packageJsonPath = path.join(ROOT, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const metadataOnly = process.argv.includes("--metadata-only");

function assertRelativeFilePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || !value.startsWith("./")) {
    throw new Error(`Invalid ${label} in package.json: expected relative file path.`);
  }

  const resolved = path.resolve(ROOT, value);
  if (!resolved.startsWith(ROOT + path.sep)) {
    throw new Error(`Invalid ${label} in package.json: path escapes project root.`);
  }

  if (!metadataOnly) {
    if (!fs.existsSync(resolved)) {
      throw new Error(`Missing ${label} target: ${value}`);
    }

    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      throw new Error(`Invalid ${label} target: ${value} is not a file.`);
    }
  }

  return { value, resolved };
}

const mainEntry = assertRelativeFilePath(packageJson.main, "main");
const typesEntry = assertRelativeFilePath(packageJson.types, "types");

const rootExport = packageJson.exports?.["."];
if (rootExport === undefined || typeof rootExport !== "object") {
  throw new Error("Invalid exports['.'] in package.json.");
}

const exportImportEntry = assertRelativeFilePath(rootExport.import, "exports['.'].import");
const exportTypesEntry = assertRelativeFilePath(rootExport.types, "exports['.'].types");

if (mainEntry.resolved !== exportImportEntry.resolved) {
  throw new Error("package.json main and exports['.'].import must point to the same file.");
}

if (typesEntry.resolved !== exportTypesEntry.resolved) {
  throw new Error("package.json types and exports['.'].types must point to the same file.");
}

if (!metadataOnly) {
  await import(pathToFileURL(mainEntry.resolved).href);
}

console.log(metadataOnly ? "Verified package entrypoint metadata:" : "Verified package entrypoints:");
console.log(`- main: ${mainEntry.value}`);
console.log(`- types: ${typesEntry.value}`);
