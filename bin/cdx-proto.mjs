#!/usr/bin/env node
// cdx-proto CLI — zero-dependency shell entry point for converting, inspecting,
// and validating CycloneDX BOMs between canonical JSON and protobuf binary.
//
// Usage:
//   npx cdx-proto convert <input> <output> [--to 1.6]
//   npx cdx-proto inspect  <file>
//   npx cdx-proto validate <file>
//
// Formats are auto-detected by file extension via the `@cdxgen/cdx-proto/node`
// helpers: `.json` for canonical CycloneDX JSON, `.b64`/`.base64` for a
// base64-encoded protobuf payload, and anything else (`.cdx`, `.bin`, …) for
// raw protobuf binary. `convert` infers the source version from the file; pass
// `--to` to set the target spec version (defaults to the source version).
import { parseArgs } from "node:util";

import { bomStats, convertBom } from "../dist/index.js";
import { readBomFile, writeBomFile } from "../dist/node.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    to: { type: "string", default: "" },
  },
});

const [command, ...rest] = positionals;

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
    const bom = readBomFile(input);
    const targetVersion = values.to || bom.specVersion;
    if (targetVersion !== bom.specVersion) {
      const { bom: converted, warnings } = convertBom(bom, targetVersion);
      for (const warning of warnings) {
        console.error(`warning: dropped ${warning} (not expressible in ${targetVersion})`);
      }
      writeBomFile(output, converted);
    } else {
      writeBomFile(output, bom);
    }
    console.error(`Converted ${input} -> ${output} (spec ${targetVersion}).`);
  } else if (command === "inspect") {
    const [input] = rest;
    if (!input) {
      console.error("Usage: cdx-proto inspect <file>");
      process.exit(1);
    }
    const bom = readBomFile(input);
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
    const bom = readBomFile(input);
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
