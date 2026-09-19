// Tests for the consumer-driven helper APIs added for cdxgen:
//   1. toBomMessage() / isBomMessage()      — unified input coercion
//   2. cardinality-safe convertBom()        — metadata.licenses and
//                                              components[].evidence.identity
//                                              across the 1.5 <-> 1.6 boundary
//   3. normalizeSpecVersion() / isSupportedSpecVersion()
//   4. @cdxgen/cdx-proto/node file helpers  — readBomFile/writeBomFile/
//                                              isProtoBomFile
//   5. base64 payload codecs                — encodeBomBase64/decodeBomBase64/
//                                              parseBomBase64
//
// The cardinality fixtures are checked in as files (tests/fixtures/) so the
// tests exercise the exact bytes a consumer would have on disk, including the
// generated .cdx binary and .b64 artifacts.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  convertBom,
  createBom,
  decodeBomBase64,
  encodeBomBase64,
  encodeBomBinary,
  encodeBomJson,
  isBomMessage,
  isSupportedSpecVersion,
  normalizeSpecVersion,
  parseBomBase64,
  parseBomJson,
  supportedSpecVersions,
  toBomMessage,
} from "../dist/index.js";
import * as v16 from "../dist/v1.6.js";
import { create } from "@bufbuild/protobuf";
import {
  isProtoBomFile,
  protoBomFileExtensions,
  readBomFile,
  writeBomFile,
} from "../dist/node.js";

const fixturesDir = path.join(import.meta.dirname, "fixtures");
const readFixtureJson = (name) =>
  JSON.parse(readFileSync(path.join(fixturesDir, name), "utf8"));

test("isBomMessage accepts decoded BOMs and rejects everything else", () => {
  for (const specVersion of supportedSpecVersions) {
    assert.equal(isBomMessage(createBom(specVersion)), true, specVersion);
  }
  // A decoded BOM from JSON, not just createBom.
  const bom = parseBomJson(readFixtureJson("bom-1.6-cardinality.json"));
  assert.equal(isBomMessage(bom), true);

  // Plain objects, look-alikes, and other protobuf messages are not BOMs.
  assert.equal(isBomMessage({ specVersion: "1.6", $typeName: "x" }), false);
  assert.equal(isBomMessage({ bomFormat: "CycloneDX" }), false);
  assert.equal(isBomMessage(null), false);
  assert.equal(isBomMessage(undefined), false);
  assert.equal(isBomMessage([]), false);
  assert.equal(
    isBomMessage(create(v16.ComponentSchema, {})),
    false,
    "a non-Bom protobuf message must not pass the guard",
  );
});

test("toBomMessage passes decoded messages through unchanged", () => {
  const bom = parseBomJson(readFixtureJson("bom-1.6-cardinality.json"));
  assert.equal(toBomMessage(bom), bom);
});

test("toBomMessage parses JSON strings, with or without an embedded version", () => {
  const versioned = toBomMessage(
    JSON.stringify({ specVersion: "1.5", version: 7 }),
  );
  assert.equal(versioned.$typeName, "cyclonedx.v1_5.Bom");
  assert.equal(versioned.version, 7);

  // No specVersion anywhere: the fallback version decides.
  const unversioned = toBomMessage(JSON.stringify({ version: 2 }), "1.6");
  assert.equal(unversioned.$typeName, "cyclonedx.v1_6.Bom");

  // The snake_case spelling is honoured too.
  const snakeCase = toBomMessage(JSON.stringify({ spec_version: "1.6" }));
  assert.equal(snakeCase.$typeName, "cyclonedx.v1_6.Bom");
});

test("toBomMessage dispatches objects by version presence and falls back for empty input", () => {
  const explicit = toBomMessage({ specVersion: "1.5", version: 1 });
  assert.equal(explicit.$typeName, "cyclonedx.v1_5.Bom");

  const fallback = toBomMessage({ version: 1 }, "1.5");
  assert.equal(fallback.$typeName, "cyclonedx.v1_5.Bom");

  // Absent input yields an empty BOM at the fallback version (cdxgen's
  // writeBinary({}, file) relies on this shape of behaviour).
  assert.equal(toBomMessage({}).$typeName, "cyclonedx.v1_7.Bom");
  assert.equal(toBomMessage(null, "1.5").$typeName, "cyclonedx.v1_5.Bom");
  assert.equal(toBomMessage(undefined, "1.6").$typeName, "cyclonedx.v1_6.Bom");
});

test("toBomMessage forwards JSON read options to the underlying decode", () => {
  const payload = { version: 1, totallyUnknownField: true };
  assert.throws(() => toBomMessage(payload, "1.6"), /unknown/u);
  const lenient = toBomMessage(payload, "1.6", { ignoreUnknownFields: true });
  assert.equal(lenient.$typeName, "cyclonedx.v1_6.Bom");
});

test("toBomMessage rejects versions it cannot dispatch", () => {
  assert.throws(
    () => toBomMessage({ specVersion: "1.4", version: 1 }),
    /Unsupported CycloneDX spec version: 1\.4/u,
  );
});

test("convertBom upgrades 1.5 singular boundary fields to 1.6 arrays without warnings", () => {
  const bom15 = parseBomJson(readFixtureJson("bom-1.5-cardinality.json"));
  const { bom, warnings } = convertBom(bom15, "1.6");

  assert.deepEqual(warnings, []);
  const canonical = encodeBomJson(bom);
  // metadata.licenses: single object in 1.5 -> array of one in 1.6.
  assert.deepEqual(canonical.metadata.licenses, [
    { expression: "MIT OR Apache-2.0" },
  ]);
  // evidence.identity: single object in 1.5 -> array of one in 1.6.
  assert.deepEqual(canonical.components[0].evidence.identity, [
    {
      field: "purl",
      confidence: 0.875,
      methods: [{ technique: "manifest-analysis", confidence: 0.75 }],
      tools: ["pkg:npm/cdxgen@11.0.0"],
    },
  ]);
});

test("convertBom downgrades 1.6 boundary arrays to 1.6-era singulars with visible loss", () => {
  const bom16 = parseBomJson(readFixtureJson("bom-1.6-cardinality.json"));
  const { bom, warnings } = convertBom(bom16, "1.5");

  const canonical = encodeBomJson(bom);
  // Only the first identity and the first license survive; everything the
  // 1.5 schema cannot express is reported as a warning path.
  assert.deepEqual(canonical.metadata.licenses, { expression: "MIT" });
  assert.deepEqual(canonical.components[0].evidence.identity, {
    field: "purl",
    confidence: 0.875,
    methods: [{ technique: "manifest-analysis", confidence: 0.75 }],
    tools: ["pkg:npm/cdxgen@11.0.0"],
  });
  assert.deepEqual(warnings, [
    "$.components[].evidence.identity[1]",
    "$.components[].evidence.identity[2]",
    "$.components[].evidence.identity[].concludedValue",
    "$.metadata.licenses[1]",
  ]);
});

test("convertBom survives a double hop over the 1.5/1.6 boundary", () => {
  const bom15 = parseBomJson(readFixtureJson("bom-1.5-cardinality.json"));
  const upgraded = convertBom(bom15, "1.6");
  const backDown = convertBom(upgraded.bom, "1.5");
  assert.deepEqual(backDown.warnings, []);
  assert.deepEqual(encodeBomJson(backDown.bom), encodeBomJson(bom15));
});

test("normalizeSpecVersion accepts canonical, v-prefixed, numeric, and patch spellings", () => {
  assert.equal(normalizeSpecVersion("1.6"), "1.6");
  assert.equal(normalizeSpecVersion("v1.5"), "1.5");
  assert.equal(normalizeSpecVersion(1.7), "1.7");
  assert.equal(normalizeSpecVersion("1.6.0"), "1.6");
  assert.throws(() => normalizeSpecVersion("1.4"), /Unsupported/u);
  assert.throws(() => normalizeSpecVersion("2.0"), /Unsupported/u);
});

test("isSupportedSpecVersion is the non-throwing probe", () => {
  assert.equal(isSupportedSpecVersion("1.5"), true);
  assert.equal(isSupportedSpecVersion("v1.6"), true);
  assert.equal(isSupportedSpecVersion(1.7), true);
  assert.equal(isSupportedSpecVersion("1.4"), false);
  assert.equal(isSupportedSpecVersion("2.0"), false);
  assert.equal(isSupportedSpecVersion(undefined), false);
  assert.equal(isSupportedSpecVersion(null), false);
  assert.equal(isSupportedSpecVersion({}), false);
});

test("encodeBomBase64 / parseBomBase64 round-trip a canonical BOM", () => {
  const bom = parseBomJson(readFixtureJson("bom-1.6-cardinality.json"));
  const base64 = encodeBomBase64(bom);

  // The payload must be exactly the base64 of the plain binary encoding.
  assert.equal(base64, Buffer.from(encodeBomBinary(bom)).toString("base64"));
  assert.deepEqual(encodeBomJson(parseBomBase64(base64)), encodeBomJson(bom));

  // Known-version decode takes the same path.
  assert.equal(decodeBomBase64("1.6", base64).$typeName, bom.$typeName);
  assert.throws(() => decodeBomBase64("1.5", base64), /spec version mismatch/u);
});

test("parseBomBase64 rejects payloads no schema can decode", () => {
  assert.throws(() => parseBomBase64("not base64 at all!!"), /base64/u);
  // Valid base64 of non-protobuf bytes fails inside the binary decoder.
  assert.throws(() =>
    parseBomBase64(Buffer.from("junk").toString("base64")),
  );
});

test("isProtoBomFile recognises the conventional protobuf extensions", () => {
  assert.deepEqual(protoBomFileExtensions, [".cdx", ".cdx.bin", ".proto"]);
  assert.equal(isProtoBomFile("bom.cdx"), true);
  assert.equal(isProtoBomFile("out/bom.CDX"), true);
  assert.equal(isProtoBomFile("/tmp/dir/bom.cdx.bin"), true);
  assert.equal(isProtoBomFile("schema.proto"), true);
  assert.equal(isProtoBomFile("bom.json"), false);
  assert.equal(isProtoBomFile("bom.b64"), false);
  assert.equal(isProtoBomFile(undefined), false);
});

test("readBomFile decodes json, binary, and base64 fixtures", () => {
  const expected = readBomFile(path.join(fixturesDir, "bom-1.6-cardinality.json"));

  const fromBinary = readBomFile(
    path.join(fixturesDir, "bom-1.6-cardinality.cdx"),
  );
  assert.equal(fromBinary.$typeName, "cyclonedx.v1_6.Bom");
  assert.deepEqual(encodeBomJson(fromBinary), encodeBomJson(expected));

  const fromBase64 = readBomFile(
    path.join(fixturesDir, "bom-1.6-cardinality.b64"),
  );
  assert.deepEqual(encodeBomJson(fromBase64), encodeBomJson(expected));

  // asJson returns canonical CycloneDX JSON, mirroring cdxgen's readBinary
  // with asJson=true.
  const asJson = readBomFile(
    path.join(fixturesDir, "bom-1.6-cardinality.cdx"),
    { asJson: true },
  );
  assert.equal(asJson.bomFormat, "CycloneDX");
  assert.equal(asJson.specVersion, "1.6");
});

test("writeBomFile picks the format from the extension and coerces its input", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cdx-proto-node-"));
  try {
    const bom = parseBomJson(readFixtureJson("bom-1.6-cardinality.json"));
    const expected = encodeBomJson(bom);

    for (const name of ["out.json", "out.cdx", "out.b64"]) {
      // A canonical JSON object (not a message) must be coerced on the way in.
      writeBomFile(path.join(dir, name), expected);
      assert.deepEqual(
        encodeBomJson(readBomFile(path.join(dir, name))),
        expected,
        name,
      );
    }

    // The fallback spec version covers inputs without one (cdxgen's
    // writeBinary({}, file) shape).
    writeBomFile(path.join(dir, "empty.cdx"), {}, { specVersion: "1.5" });
    assert.equal(
      readBomFile(path.join(dir, "empty.cdx")).$typeName,
      "cyclonedx.v1_5.Bom",
    );
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
