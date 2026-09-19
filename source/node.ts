// Node-only convenience layer for reading and writing BOM files, kept in a
// dedicated subpath export (`@cdxgen/cdx-proto/node`) so the main entry stays
// free of `node:` imports and remains usable from browsers, Deno, and edge
// runtimes. Import it only from Node code:
//
//   import { isProtoBomFile, readBomFile, writeBomFile } from "@cdxgen/cdx-proto/node";
//
// These helpers exist because every shell consumer of this library (cdxgen's
// `readBinary`/`writeBinary`, its `convert`/`validate`/`repl` commands, and
// this package's own CLI) ended up re-implementing the same three things:
// extension-based format detection, readFileSync/JSON.parse plumbing, and the
// list of extensions that mean "protobuf binary". Centralizing them here makes
// `@cdxgen/cdx-proto` the single source of truth for all three.
import { readFileSync, writeFileSync } from "node:fs";

import {
  encodeBomBase64,
  encodeBomBinary,
  encodeBomJson,
  encodeBomJsonString,
  parseBomBase64,
  parseBomBinary,
  parseBomJson,
  toBomMessage,
} from "./helpers.js";
import type { AnyBom, AnyBomJson } from "./helpers.js";

/**
 * File extensions conventionally used for protobuf-encoded CycloneDX BOMs.
 * cdxgen writes `bom.cdx` by default and accepts all three on input; keep this
 * list in sync with any consumer that gates on "is this file a proto BOM?".
 */
export const protoBomFileExtensions = [
  ".cdx",
  ".cdx.bin",
  ".proto",
] as const;

/**
 * `true` when `filePath` ends with one of {@link protoBomFileExtensions}
 * (case-insensitive). JSON BOMs and anything else return `false`.
 */
export function isProtoBomFile(filePath: unknown): boolean {
  const normalized = `${filePath ?? ""}`.toLowerCase();
  return protoBomFileExtensions.some((extension) =>
    normalized.endsWith(extension),
  );
}

function isJsonBomFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".json");
}

function isBase64BomFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return normalized.endsWith(".b64") || normalized.endsWith(".base64");
}

export type ReadBomFileOptions = {
  /**
   * Return canonical CycloneDX JSON (the output of `encodeBomJson`) instead of
   * the decoded message. Mirrors cdxgen's `readBinary(binFile, asJson)`.
   */
  asJson?: boolean;
};

/**
 * Reads a BOM file and decodes it, auto-detecting the payload format from the
 * extension: `.json` for canonical CycloneDX JSON, `.b64`/`.base64` for a
 * base64-encoded protobuf binary, and anything else (`.cdx`, `.cdx.bin`,
 * `.proto`, `.bin`, …) as raw protobuf binary. The spec version is
 * auto-detected from the document itself; throws when no supported schema can
 * decode it.
 */
export function readBomFile(
  filePath: string,
  options?: ReadBomFileOptions,
): AnyBom | AnyBomJson {
  const data = readFileSync(filePath);
  const bom: AnyBom = isJsonBomFile(filePath)
    ? parseBomJson(JSON.parse(data.toString("utf8")))
    : isBase64BomFile(filePath)
      ? parseBomBase64(data.toString("utf8").trim())
      : parseBomBinary(new Uint8Array(data));
  return options?.asJson ? encodeBomJson(bom) : bom;
}

export type WriteBomFileOptions = {
  /**
   * Fallback spec version for inputs that are neither a decoded message nor a
   * versioned JSON object (see `toBomMessage`). Defaults to the latest
   * supported version.
   */
  specVersion?: string | number;
};

/**
 * Encodes `value` (a decoded message, a canonical JSON object, or a JSON
 * string — anything `toBomMessage` accepts) and writes it to `filePath`,
 * choosing the format from the extension: `.json` writes pretty canonical
 * CycloneDX JSON, `.b64`/`.base64` writes a base64 protobuf payload, and
 * anything else writes raw protobuf binary. Mirrors cdxgen's `writeBinary`
 * combined with this CLI's save step.
 */
export function writeBomFile(
  filePath: string,
  value: unknown,
  options?: WriteBomFileOptions,
): void {
  const bom = toBomMessage(value, options?.specVersion);
  if (isJsonBomFile(filePath)) {
    writeFileSync(filePath, encodeBomJsonString(bom, { prettySpaces: 2 }));
  } else if (isBase64BomFile(filePath)) {
    writeFileSync(filePath, encodeBomBase64(bom));
  } else {
    writeFileSync(filePath, encodeBomBinary(bom));
  }
}
