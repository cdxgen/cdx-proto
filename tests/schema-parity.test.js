// Schema-parity guard: walks each BomSchema descriptor tree against the
// corresponding upstream CycloneDX JSON schema and fails on any canonical
// JSON property name that has no reachable proto field and no entry in the
// bridge layer's alias/special-case tables. This converts the class of
// "silently dropped property" bugs (dependsOn, cryptoRefArray, postalCode,
// collection, expressionDetails) from silently shipping into a CI failure.
//
// The upstream JSON schemas are not vendored (they are ~750 KB combined). The
// test resolves their location from the CDX_SPEC_UPSTREAM environment
// variable (or a default sibling checkout path) and skips gracefully when they
// are unavailable, so it never breaks an environment that lacks the upstream
// specification checkout.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { BomSchema as BomSchema15 } from "../dist/v1.5.js";
import { BomSchema as BomSchema16 } from "../dist/v1.6.js";
import { BomSchema as BomSchema17 } from "../dist/v1.7.js";

// `new URL(".", import.meta.url).pathname` ends in "/", so path.dirname
// already strips the trailing "tests/" segment — "../../cyclonedx" therefore
// resolves to <repo>/../../cyclonedx, the same default checkout location as
// scripts/check-spec-drift.mjs.
const upstreamDir =
  process.env.CDX_SPEC_UPSTREAM ??
  path.resolve(
    path.dirname(new URL(".", import.meta.url).pathname),
    "../../cyclonedx/specification/schema",
  );

const schemas = [
  { version: "1.5", schema: BomSchema15, file: "bom-1.5.schema.json" },
  { version: "1.6", schema: BomSchema16, file: "bom-1.6.schema.json" },
  { version: "1.7", schema: BomSchema17, file: "bom-1.7.schema.json" },
];

// Canonical property names produced by the bridge layer that do not appear
// directly as proto field names. Kept in sync with the alias tables and
// structural special cases in source/helpers.ts. Mirroring them here means a
// future change that introduces a new unmapped canonical property fails this
// test until the bridge (and this list) is updated.
const bridgeCanonicalNames = new Set([
  // FIELD_ALIASES values
  "bom-ref",
  "mime-type",
  "x-trust-boundary",
  // MESSAGE_FIELD_ALIASES values
  "commonExtensionName",
  "commonExtensionValue",
  "customExtensionName",
  "customExtensionValue",
  "tlpClassification",
  "content",
  "collection",
  "expressionDetails",
  "postalCode",
  "cryptoRefArray",
  // Structural special cases
  "dependsOn",
  "bomFormat",
  "specVersion",
  "spec_version",
]);

// Properties present in the canonical JSON schema that are intentionally not
// represented in the protobuf (JSF signatures) or are JSON-schema structural
// keywords that surface during the recursive property walk.
const intentionalGaps = new Set([
  "signature", // JSF signatures are unsupported by design
  "$schema", // JSON-schema meta keyword
  "items", // JSON-schema array-items keyword
  "version", // BOM version is an integer in proto but surfaced broadly
]);

function collectProtoPropertyNames(schema) {
  const names = new Set();
  const visited = new Set();
  function walkMessage(descriptor) {
    if (visited.has(descriptor.typeName)) {
      return;
    }
    visited.add(descriptor.typeName);
    for (const field of descriptor.fields) {
      names.add(field.jsonName);
      names.add(field.localName);
      names.add(field.name);
      names.add(field.name.replaceAll("_", "-"));
      if (field.message) {
        walkMessage(field.message);
      }
    }
  }
  walkMessage(schema);
  return names;
}

function collectSchemaPropertyNames(schemaJson) {
  const names = new Set();
  function walk(value) {
    if (!value || typeof value !== "object") {
      return;
    }
    if (value.properties) {
      for (const key of Object.keys(value.properties)) {
        names.add(key);
      }
    }
    for (const child of Object.values(value)) {
      if (typeof child === "object") {
        walk(child);
      }
    }
  }
  walk(schemaJson);
  return names;
}

for (const { version, schema, file } of schemas) {
  const schemaPath = path.join(upstreamDir, file);

  test(`schema-parity: every canonical JSON property in bom-${version} is reachable from the proto descriptor tree`, () => {
    if (!fs.existsSync(schemaPath)) {
      test.skip(`upstream schema not found at ${schemaPath}; set CDX_SPEC_UPSTREAM to enable this guard`);
      return;
    }

    const protoNames = collectProtoPropertyNames(schema);
    for (const name of bridgeCanonicalNames) {
      protoNames.add(name);
    }

    const schemaJson = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const schemaNames = collectSchemaPropertyNames(schemaJson);

    const unmapped = [...schemaNames]
      .filter((name) => !protoNames.has(name))
      .filter((name) => !intentionalGaps.has(name))
      .sort();

    assert.deepEqual(
      unmapped,
      [],
      `bom-${version} canonical JSON properties with no proto field or alias mapping: ${unmapped.join(", ") || "(none)"}`,
    );
  });
}
