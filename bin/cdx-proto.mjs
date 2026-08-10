#!/usr/bin/env node
// cdx-proto CLI — zero-dependency shell entry point for converting, inspecting,
// and validating CycloneDX BOMs between canonical JSON and protobuf binary.
//
// Usage:
//   npx cdx-proto convert <input> <output> [--to 1.6]
//   npx cdx-proto inspect  <file>
//   npx cdx-proto validate <file>
//
// The input/output format is auto-detected by extension: `.json` for canonical
// CycloneDX JSON, `.bin` (or anything else) for protobuf binary. `convert`
// infers the source version from the file; pass `--to` to set the target spec
// version (defaults to the source version).
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";

import {
  bomStats,
  convertBom,
  encodeBomBinary,
  encodeBomJsonString,
  parseBomBinary,
  parseBomJson,
} from "../dist/index.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    to: { type: "string", default: "" },
  },
});

const [command, ...rest] = positionals;

function loadBom(filePath) {
  const data = readFileSync(filePath);
  if (filePath.endsWith(".json")) {
    return parseBomJson(JSON.parse(data.toString("utf8")));
  }
  return parseBomBinary(new Uint8Array(data));
}

function saveBom(bom, filePath) {
  if (filePath.endsWith(".json")) {
    writeFileSync(filePath, encodeBomJsonString(bom, { prettySpaces: 2 }));
  } else {
    writeFileSync(filePath, encodeBomBinary(bom));
  }
}

function formatBytes(bytes) {
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(2)} MB`;
  }
  if (bytes >= 1000) {
    return `${(bytes / 1000).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

try {
  if (command === "convert") {
    const [input, output] = rest;
    if (!input || !output) {
      console.error("Usage: cdx-proto convert <input> <output> [--to 1.6]");
      process.exit(1);
    }
    const bom = loadBom(input);
    const targetVersion = values.to || bom.specVersion;
    if (targetVersion !== bom.specVersion) {
      const { bom: converted, warnings } = convertBom(bom, targetVersion);
      for (const warning of warnings) {
        console.error(`warning: dropped field ${warning} (not in ${targetVersion})`);
      }
      saveBom(converted, output);
    } else {
      saveBom(bom, output);
    }
    console.error(`Converted ${input} -> ${output} (spec ${targetVersion}).`);
  } else if (command === "inspect") {
    const [input] = rest;
    if (!input) {
      console.error("Usage: cdx-proto inspect <file>");
      process.exit(1);
    }
    const bom = loadBom(input);
    const stats = bomStats(bom);
    console.log(`spec version:    ${stats.specVersion}`);
    console.log(`components:      ${stats.componentCount}`);
    console.log(`dependencies:    ${stats.dependencyCount}`);
    console.log(`json size:       ${formatBytes(stats.jsonByteSize)}`);
    console.log(`binary size:     ${formatBytes(stats.binaryByteSize)}`);
    console.log(`compression:     ${(stats.compressionRatio * 100).toFixed(0)}% of JSON`);
  } else if (command === "validate") {
    const [input] = rest;
    if (!input) {
      console.error("Usage: cdx-proto validate <file>");
      process.exit(1);
    }
    const bom = loadBom(input);
    console.log(`OK — spec ${bom.specVersion}, ${bom.components.length} components.`);
  } else {
    console.error(
      "Usage: cdx-proto <convert|inspect|validate> <file> [options]",
    );
    process.exit(1);
  }
} catch (error) {
  console.error(
    `error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
