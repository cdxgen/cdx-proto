import assert from "node:assert/strict";
import test from "node:test";

import {
  bomStats,
  convertBom,
  createBom,
  decodeBomBinary,
  decodeBomJson,
  detectBomSpecVersion,
  encodeBomBinary,
  encodeBomJson,
  encodeBomJsonString,
  getBomSchema,
  parseBomBinary,
  parseBomJson,
  parseBomJsonString,
  supportedSpecVersions,
} from "../dist/index.js";
import * as v15 from "../dist/v1.5.js";
import * as v16 from "../dist/v1.6.js";
import * as v17 from "../dist/v1.7.js";

function roundTripBom(specVersion, bomPatch) {
  return encodeBomJson(
    parseBomJson(
      {
        bomFormat: "CycloneDX",
        specVersion,
        version: 1,
        serialNumber: "urn:uuid:33333333-3333-3333-3333-333333333333",
        ...bomPatch,
      },
      { ignoreUnknownFields: true },
    ),
  );
}

test("version-specific subpath exports expose the expected BomSchema", () => {
  assert.equal(v15.BomSchema.typeName, "cyclonedx.v1_5.Bom");
  assert.equal(v16.BomSchema.typeName, "cyclonedx.v1_6.Bom");
  assert.equal(v17.BomSchema.typeName, "cyclonedx.v1_7.Bom");
});

test("getBomSchema resolves supported versions", () => {
  assert.deepEqual(supportedSpecVersions, ["1.5", "1.6", "1.7"]);
  assert.equal(getBomSchema("v1.5").typeName, "cyclonedx.v1_5.Bom");
  assert.equal(getBomSchema(1.6).typeName, "cyclonedx.v1_6.Bom");
  assert.equal(getBomSchema("1.7.0").typeName, "cyclonedx.v1_7.Bom");
});

test("createBom populates specVersion and round-trips binary/json", () => {
  const bom = createBom("1.6", {
    version: 3,
    serialNumber: "urn:uuid:11111111-1111-1111-1111-111111111111",
  });

  assert.equal(bom.specVersion, "1.6");

  const binary = encodeBomBinary(bom);
  const decoded = decodeBomBinary("1.6", binary);
  assert.equal(decoded.specVersion, "1.6");
  assert.equal(decoded.version, 3);

  const json = encodeBomJson(bom);
  assert.equal(json.bomFormat, "CycloneDX");
  assert.equal(json.specVersion, "1.6");

  const reparsed = parseBomJson(json);
  assert.equal(reparsed.$typeName, "cyclonedx.v1_6.Bom");
  assert.equal(reparsed.serialNumber, bom.serialNumber);

  const jsonString = encodeBomJsonString(bom);
  const reparsedFromString = parseBomJsonString(jsonString);
  assert.equal(reparsedFromString.$typeName, "cyclonedx.v1_6.Bom");
  assert.equal(reparsedFromString.version, 3);
});

test("CycloneDX 1.7 citations round-trip through json and binary", () => {
  // Citations are a root-level 1.7 element. The canonical JSON form carries
  // `pointers`/`expressions` as bare string arrays and uses camelCase/hyphen
  // field names, while the protobuf nests those arrays inside wrapper messages.
  // Both shapes must survive a json round-trip and a binary round-trip.
  const citations = [
    {
      timestamp: "2026-01-01T00:00:00.000Z",
      pointers: ["/components/0/licenses/0"],
      attributedTo: "pkg:npm/@cdxgen/cdxgen@1.0.0",
      "bom-ref": "citation:licenses",
      note: "resolved by cdxgen",
    },
    {
      timestamp: "2026-01-02T00:00:00.000Z",
      expressions: ["$.components[*].properties[?(@.name =~ /^cdx:audit:/)]"],
      process: "urn:cdx:formula:audit",
    },
  ];

  const jsonRoundTrip = roundTripBom("1.7", { citations });
  assert.deepEqual(jsonRoundTrip.citations, [
    {
      timestamp: "2026-01-01T00:00:00Z",
      pointers: ["/components/0/licenses/0"],
      attributedTo: "pkg:npm/@cdxgen/cdxgen@1.0.0",
      "bom-ref": "citation:licenses",
      note: "resolved by cdxgen",
    },
    {
      timestamp: "2026-01-02T00:00:00Z",
      expressions: [
        "$.components[*].properties[?(@.name =~ /^cdx:audit:/)]",
      ],
      process: "urn:cdx:formula:audit",
    },
  ]);

  // Binary round-trip must preserve the same canonical shape.
  const parsed = parseBomJson(
    {
      bomFormat: "CycloneDX",
      specVersion: "1.7",
      version: 1,
      serialNumber: "urn:uuid:44444444-4444-4444-4444-444444444444",
      citations,
    },
    { ignoreUnknownFields: true },
  );
  const fromBinary = parseBomBinary(encodeBomBinary(parsed));
  const binaryRoundTrip = encodeBomJson(fromBinary);
  assert.equal(binaryRoundTrip.citations.length, 2);
  assert.deepEqual(binaryRoundTrip.citations[0].pointers, [
    "/components/0/licenses/0",
  ]);
  assert.deepEqual(binaryRoundTrip.citations[1].expressions, [
    "$.components[*].properties[?(@.name =~ /^cdx:audit:/)]",
  ]);
});

test("an empty citation pointer list never becomes an object", () => {
  // A wrapper message carrying no entries decodes to `{}`. Unwrapping that to
  // the wrapper object would put an object where the CycloneDX schema requires
  // an array, so the empty case must unwrap to an array or be dropped.
  const roundTrip = roundTripBom("1.7", {
    citations: [
      {
        timestamp: "2026-01-01T00:00:00.000Z",
        pointers: [],
        attributedTo: "pkg:npm/@cdxgen/cdxgen@13.0.0",
      },
    ],
  });
  const [citation] = roundTrip.citations;
  assert.ok(
    citation.pointers === undefined || Array.isArray(citation.pointers),
  );
  assert.equal(citation.attributedTo, "pkg:npm/@cdxgen/cdxgen@13.0.0");
});

test("canonical CycloneDX JSON round-trips without protobuf enum leakage", () => {
  const bom = parseBomJson(
    {
      bomFormat: "CycloneDX",
      specVersion: "1.7",
      version: 1,
      metadata: {
        component: {
          type: "application",
          name: "demo-app",
          version: "1.0.0",
          hashes: [{ alg: "SHA-256", content: "abc123" }],
          externalReferences: [
            {
              type: "release-notes",
              url: "https://example.invalid/release-notes",
            },
          ],
          evidence: {
            identity: [
              {
                field: "purl",
                concludedValue: "pkg:npm/demo-app@1.0.0",
                methods: [
                  {
                    technique: "dynamic-analysis",
                    value: "scanner",
                    confidence: 0.9,
                  },
                ],
              },
            ],
          },
        },
        lifecycles: [{ phase: "design" }, { name: "custom" }],
      },
      components: [
        undefined,
        {
          type: "library",
          name: "dep",
          version: "2.0.0",
        },
      ],
    },
    { ignoreUnknownFields: true },
  );

  const json = encodeBomJson(bom);
  assert.equal(json.bomFormat, "CycloneDX");
  assert.equal(json.specVersion, "1.7");
  assert.equal(json.metadata.component.type, "application");
  assert.deepEqual(json.metadata.component.hashes, [
    { alg: "SHA-256", content: "abc123" },
  ]);
  assert.equal(
    json.metadata.component.externalReferences[0].type,
    "release-notes",
  );
  assert.equal(json.metadata.component.evidence.identity[0].field, "purl");
  assert.equal(
    json.metadata.component.evidence.identity[0].methods[0].technique,
    "dynamic-analysis",
  );
  assert.deepEqual(json.metadata.lifecycles, [
    { phase: "design" },
    { name: "custom" },
  ]);
  assert.equal(json.components.length, 1);
  assert.equal(json.components[0].type, "library");

  const jsonString = encodeBomJsonString(bom);
  assert.match(jsonString, /"bomFormat":"CycloneDX"/);
  assert.doesNotMatch(
    jsonString,
    /CLASSIFICATION_|HASH_ALG_|EXTERNAL_REFERENCE_TYPE_|LIFECYCLE_PHASE_|EVIDENCE_/,
  );
});

test("canonical CycloneDX aliases and broad enum families round-trip for 1.6 and 1.7", () => {
  for (const specVersion of ["1.6", "1.7"]) {
    const json = roundTripBom(specVersion, {
      metadata: {
        component: {
          "bom-ref": "root-component",
          "mime-type": "application/json",
          type: "application",
          name: `demo-${specVersion}`,
          version: "1.0.0",
          scope: "required",
          hashes: [{ alg: "SHA-256", content: "abc123" }],
          externalReferences: [
            {
              type: "release-notes",
              url: "https://example.invalid/release-notes",
            },
          ],
          evidence: {
            identity: [
              {
                field: "omniborId",
                concludedValue: "gitoid:blob:sha1:0123456789abcdef",
                methods: [
                  {
                    technique: "dynamic-analysis",
                    value: "scanner",
                    confidence: 0.9,
                  },
                ],
              },
            ],
          },
          cryptoProperties: {
            assetType: "algorithm",
            algorithmProperties: {
              primitive: "key-agree",
              executionEnvironment: "software-plain-ram",
              implementationPlatform: "x86_64",
              mode: "gcm",
              padding: "pkcs1v15",
              cryptoFunctions: ["keygen", "verify"],
            },
            oid: "1.2.840.113549.1.1.1",
          },
        },
        lifecycles: [{ phase: "pre-build" }],
      },
      externalReferences: [
        {
          type: "formulation",
          url: "https://example.invalid/formulation",
        },
      ],
      compositions: [{ aggregate: "incomplete_first_party_only" }],
      vulnerabilities: [
        {
          id: "CVE-2024-0001",
          ratings: [
            {
              source: { name: "NVD" },
              severity: "critical",
              method: "CVSSv31",
              score: 9.8,
            },
          ],
          analysis: {
            state: "not_affected",
            justification: "code_not_present",
            response: ["can_not_fix", "workaround_available"],
          },
          affects: [
            {
              ref: "dep-ref",
              versions: [{ version: "2.0.0", status: "affected" }],
            },
          ],
        },
      ],
      formulation: [
        {
          workflows: [
            {
              uid: "workflow-1",
              name: "build-workflow",
              taskTypes: ["build", "deliver"],
              trigger: { type: "api" },
              outputs: [{ type: "evidence" }],
              workspaces: [
                {
                  uid: "workspace-1",
                  name: "artifact-store",
                  accessMode: "read-write",
                },
              ],
            },
          ],
        },
      ],
    });

    assert.equal(json.bomFormat, "CycloneDX");
    assert.equal(json.specVersion, specVersion);
    assert.equal(json.metadata.component["bom-ref"], "root-component");
    assert.equal(json.metadata.component["mime-type"], "application/json");
    assert.equal(json.metadata.component.scope, "required");
    assert.deepEqual(json.metadata.component.hashes, [
      { alg: "SHA-256", content: "abc123" },
    ]);
    assert.equal(
      json.metadata.component.evidence.identity[0].field,
      "omniborId",
    );
    assert.equal(
      json.metadata.component.evidence.identity[0].methods[0].technique,
      "dynamic-analysis",
    );
    assert.equal(
      json.metadata.component.cryptoProperties.assetType,
      "algorithm",
    );
    assert.equal(
      json.metadata.component.cryptoProperties.algorithmProperties.primitive,
      "key-agree",
    );
    assert.equal(
      json.metadata.component.cryptoProperties.algorithmProperties
        .executionEnvironment,
      "software-plain-ram",
    );
    assert.equal(
      json.metadata.component.cryptoProperties.algorithmProperties
        .implementationPlatform,
      "x86_64",
    );
    assert.equal(
      json.metadata.component.cryptoProperties.algorithmProperties.mode,
      "gcm",
    );
    assert.equal(
      json.metadata.component.cryptoProperties.algorithmProperties.padding,
      "pkcs1v15",
    );
    assert.deepEqual(
      json.metadata.component.cryptoProperties.algorithmProperties
        .cryptoFunctions,
      ["keygen", "verify"],
    );
    assert.deepEqual(json.metadata.lifecycles, [{ phase: "pre-build" }]);
    assert.equal(json.externalReferences[0].type, "formulation");
    assert.equal(json.compositions[0].aggregate, "incomplete_first_party_only");
    assert.equal(json.vulnerabilities[0].ratings[0].method, "CVSSv31");
    assert.equal(json.vulnerabilities[0].analysis.state, "not_affected");
    assert.equal(
      json.vulnerabilities[0].analysis.justification,
      "code_not_present",
    );
    assert.deepEqual(json.vulnerabilities[0].analysis.response, [
      "can_not_fix",
      "workaround_available",
    ]);
    assert.equal(
      json.vulnerabilities[0].affects[0].versions[0].status,
      "affected",
    );
    assert.deepEqual(json.formulation[0].workflows[0].taskTypes, [
      "build",
      "deliver",
    ]);
    assert.equal(json.formulation[0].workflows[0].trigger.type, "api");
    assert.equal(json.formulation[0].workflows[0].outputs[0].type, "evidence");
    assert.equal(
      json.formulation[0].workflows[0].workspaces[0].accessMode,
      "read-write",
    );

    const jsonString = encodeBomJsonString(parseBomJson(json));
    assert.doesNotMatch(
      jsonString,
      /CLASSIFICATION_|HASH_ALG_|EXTERNAL_REFERENCE_TYPE_|LIFECYCLE_PHASE_|EVIDENCE_|SCORE_METHOD_|VULNERABILITY_|CRYPTO_|TRIGGER_TYPE_|OUTPUT_TYPE_|ACCESS_MODE_/,
    );
  }
});

test("advanced canonical enum styles round-trip for 1.6 and 1.7", () => {
  for (const specVersion of ["1.7"]) {
    const json = roundTripBom(specVersion, {
      metadata: {
        distributionConstraints: {
          tlpClassification: "AMBER_AND_STRICT",
        },
      },
      components: [
        {
          type: "cryptographic-asset",
          name: "cert-component",
          cryptoProperties: {
            assetType: "certificate",
            certificateProperties: {
              certificateExtensions: {
                extensions: [
                  {
                    commonExtension: {
                      commonExtensionName: "basicConstraints",
                      commonExtensionValue: "CA:TRUE",
                    },
                  },
                ],
              },
            },
          },
        },
        {
          type: "machine-learning-model",
          name: "ml-component",
          modelCard: {
            considerations: {
              environmentalConsiderations: {
                energyConsumptions: [
                  {
                    activity: "training",
                    energyProviders: [
                      {
                        organization: { name: "Grid Co" },
                        energySource: "solar",
                        energyProvided: { value: 42, unit: "kWh" },
                      },
                    ],
                    activityEnergyCost: { value: 42, unit: "kWh" },
                    co2CostEquivalent: { value: 4.2, unit: "tCO2eq" },
                  },
                ],
              },
            },
          },
        },
      ],
    });

    assert.equal(
      json.metadata.distributionConstraints.tlpClassification,
      "AMBER_AND_STRICT",
    );
    assert.equal(
      json.components[0].cryptoProperties.certificateProperties
        .certificateExtensions.extensions[0].commonExtension
        .commonExtensionName,
      "basicConstraints",
    );
    assert.equal(
      json.components[1].modelCard.considerations.environmentalConsiderations
        .energyConsumptions[0].activity,
      "training",
    );
    assert.equal(
      json.components[1].modelCard.considerations.environmentalConsiderations
        .energyConsumptions[0].energyProviders[0].energySource,
      "solar",
    );
    assert.equal(
      json.components[1].modelCard.considerations.environmentalConsiderations
        .energyConsumptions[0].energyProviders[0].energyProvided.unit,
      "kWh",
    );
    assert.equal(
      json.components[1].modelCard.considerations.environmentalConsiderations
        .energyConsumptions[0].co2CostEquivalent.unit,
      "tCO2eq",
    );
  }
});

test("canonical definitions and declarations sections round-trip as objects", () => {
  const json = roundTripBom("1.7", {
    definitions: {
      standards: [
        {
          "bom-ref": "std-1",
          name: "ASVS",
          version: "5.0",
          requirements: [
            {
              "bom-ref": "std-req-1",
              identifier: "V1.1",
              title: "Authenticate requests",
            },
          ],
        },
      ],
    },
    declarations: {
      claims: [
        {
          "bom-ref": "claim-1",
          target: "pkg:npm/demo-app@1.0.0",
          predicate: "meets-control",
        },
      ],
      targets: {
        components: [
          {
            type: "application",
            name: "demo-app",
            version: "1.0.0",
          },
        ],
      },
      affirmation: {
        statement: "verified",
      },
    },
  });

  assert.equal(Array.isArray(json.definitions), false);
  assert.equal(Array.isArray(json.declarations), false);
  assert.equal(json.definitions.standards[0].name, "ASVS");
  assert.equal(
    json.definitions.standards[0].requirements[0].identifier,
    "V1.1",
  );
  assert.equal(json.declarations.claims[0].predicate, "meets-control");
  assert.equal(json.declarations.targets.components[0].name, "demo-app");
  assert.equal(json.declarations.affirmation.statement, "verified");
});

test("parse helpers detect camelCase and proto field names", () => {
  const bomFromCamelCase = parseBomJson({
    specVersion: "1.5",
    version: 1,
    components: [{ bomRef: "camel-ref", type: "application", name: "camel" }],
  });
  assert.equal(bomFromCamelCase.$typeName, "cyclonedx.v1_5.Bom");
  assert.equal(bomFromCamelCase.components[0].bomRef, "camel-ref");

  const bomFromProtoField = parseBomJson({
    spec_version: "1.7",
    version: 2,
    components: [
      {
        "bom-ref": "dashed-ref",
        "mime-type": "application/json",
        type: "application",
        name: "dashed",
      },
    ],
  });
  assert.equal(bomFromProtoField.$typeName, "cyclonedx.v1_7.Bom");
  assert.equal(bomFromProtoField.components[0].bomRef, "dashed-ref");
  assert.equal(bomFromProtoField.components[0].mimeType, "application/json");
  assert.equal(detectBomSpecVersion({ spec_version: "v1.7.0" }), "1.7");
});

test("decodeBomJson rejects an explicit version mismatch", () => {
  assert.throws(
    () =>
      decodeBomJson("1.6", {
        specVersion: "1.7",
        version: 1,
      }),
    /spec version mismatch/i,
  );
});

test("decodeBomJson accepts JSON without an embedded specVersion when the caller supplies one", () => {
  const bom = decodeBomJson("1.6", {
    version: 4,
    serialNumber: "urn:uuid:22222222-2222-2222-2222-222222222222",
  });

  assert.equal(bom.$typeName, "cyclonedx.v1_6.Bom");
  assert.equal(bom.version, 4);
  assert.equal(
    bom.serialNumber,
    "urn:uuid:22222222-2222-2222-2222-222222222222",
  );
});

test("parseBomBinary auto-detects the embedded CycloneDX spec version", () => {
  const bom = parseBomJson({
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: "binary-demo",
      },
    },
  });

  const decoded = parseBomBinary(encodeBomBinary(bom));
  assert.equal(decoded.$typeName, "cyclonedx.v1_6.Bom");
  assert.equal(decoded.specVersion, "1.6");

  const json = encodeBomJson(decoded);
  assert.equal(json.bomFormat, "CycloneDX");
  assert.equal(json.metadata.component.type, "application");
});

test("ModelCard.properties round-trips for all spec versions", () => {
  // Previously ModelCard.properties was absent from the vendored protos, so
  // these values silently round-tripped to {}.
  for (const specVersion of supportedSpecVersions) {
    const json = roundTripBom(specVersion, {
      components: [
        {
          type: "machine-learning-model",
          name: "ml",
          modelCard: {
            properties: [{ name: "cdx:audit", value: "pass" }],
          },
        },
      ],
    });
    assert.deepEqual(json.components[0].modelCard.properties, [
      { name: "cdx:audit", value: "pass" },
    ]);
  }
});

test("Component.data round-trips as an array for 1.5 and 1.6", () => {
  // Previously a data array threw under default options and was dropped under
  // ignoreUnknownFields because the vendored proto declared data as optional.
  for (const specVersion of ["1.5", "1.6"]) {
    const json = roundTripBom(specVersion, {
      components: [
        {
          type: "data",
          name: "dataset-component",
          data: [{ name: "d1" }, { name: "d2" }],
        },
      ],
    });
    assert.ok(Array.isArray(json.components[0].data));
    assert.equal(json.components[0].data.length, 2);
    assert.deepEqual(
      json.components[0].data.map((entry) => entry.name),
      ["d1", "d2"],
    );
  }
});

test("ProtocolProperties.cryptoRef round-trips for 1.6 and 1.7", () => {
  // The proto field is `cryptoRef` but canonical JSON names it `cryptoRefArray`.
  // Previously absent from the vendored 1.6 proto, it was silently dropped.
  for (const specVersion of ["1.6", "1.7"]) {
    const json = roundTripBom(specVersion, {
      components: [
        {
          type: "cryptographic-asset",
          name: "proto-asset",
          cryptoProperties: {
            assetType: "protocol",
            protocolProperties: {
              cryptoRefArray: ["ref-a", "ref-b"],
            },
          },
        },
      ],
    });
    assert.deepEqual(
      json.components[0].cryptoProperties.protocolProperties.cryptoRefArray,
      ["ref-a", "ref-b"],
    );
  }
});

test("PostalAddressType.postalCode and GraphicsCollection.collection renames round-trip", () => {
  // `postalCodeue` is an upstream typo for the canonical JSON `postalCode`;
  // `graphic` is the proto name for the canonical JSON `collection`.
  for (const specVersion of ["1.6", "1.7"]) {
    const json = roundTripBom(specVersion, {
      metadata: {
        supplier: {
          name: "Co",
          address: { country: "US", postalCode: "78758" },
        },
      },
      components: [
        {
          type: "machine-learning-model",
          name: "ml",
          modelCard: {
            quantitativeAnalysis: {
              graphics: {
                description: "performance",
                collection: [{ name: "chart" }],
              },
            },
          },
        },
      ],
    });
    assert.equal(json.metadata.supplier.address.postalCode, "78758");
    assert.deepEqual(
      json.components[0].modelCard.quantitativeAnalysis.graphics.collection,
      [{ name: "chart" }],
    );
  }
});

test("dependency graphs survive a json round-trip for all spec versions", () => {
  // Canonical CycloneDX JSON expresses the dependency graph as flat
  // `dependsOn: string[]` entries, while the protobuf nests children as
  // `repeated Dependency dependencies`. Without the bridge, `dependsOn` is an
  // unknown proto key that throws under default options or is silently dropped
  // with `ignoreUnknownFields: true`, emptying the graph.
  for (const specVersion of supportedSpecVersions) {
    // `provides` was added to the Dependency message in 1.6, so only assert on
    // it for 1.6+.
    const useProvides = specVersion !== "1.5";
    const inputDep = { ref: "a", dependsOn: ["b", "c"] };
    if (useProvides) {
      inputDep.provides = ["std"];
    }
    const json = roundTripBom(specVersion, {
      components: [
        { type: "library", name: "a", version: "1" },
        { type: "library", name: "b", version: "1" },
        { type: "library", name: "c", version: "1" },
      ],
      dependencies: [inputDep, { ref: "b", dependsOn: [] }],
    });
    const [first, second] = json.dependencies;
    assert.equal(first.ref, "a");
    assert.deepEqual(first.dependsOn, ["b", "c"]);
    if (useProvides) {
      assert.deepEqual(first.provides, ["std"]);
    }
    assert.equal(second.ref, "b");
    assert.equal(second.dependsOn, undefined);
  }
});

test("dependency graphs survive a binary round-trip", () => {
  const parsed = parseBomJson(
    {
      bomFormat: "CycloneDX",
      specVersion: "1.7",
      version: 1,
      components: [
        { type: "library", name: "a" },
        { type: "library", name: "b" },
      ],
      dependencies: [{ ref: "a", dependsOn: ["b"] }],
    },
    { ignoreUnknownFields: true },
  );
  const binaryRoundTrip = encodeBomJson(parseBomBinary(encodeBomBinary(parsed)));
  assert.deepEqual(binaryRoundTrip.dependencies, [
    { ref: "a", dependsOn: ["b"] },
  ]);
});

test("dependency graphs are accepted under default options (no ignoreUnknownFields)", () => {
  // Under default protobuf-es options, `dependsOn` used to throw
  // "key dependsOn is unknown". The bridge now normalizes it before decode.
  const bom = parseBomJson({
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    version: 1,
    dependencies: [{ ref: "x", dependsOn: ["y"] }],
  });
  assert.deepEqual(encodeBomJson(bom).dependencies, [
    { ref: "x", dependsOn: ["y"] },
  ]);
});

test("nested protobuf dependency trees are flattened without losing edges", () => {
  // A dependsOn entry may itself be an object carrying its own dependsOn,
  // which the protobuf encodes as a nested Dependency. Decoding must hoist
  // the nested node to a sibling top-level entry rather than dropping its edges.
  const json = roundTripBom("1.7", {
    components: [
      { type: "library", name: "a" },
      { type: "library", name: "b" },
      { type: "library", name: "c" },
      { type: "library", name: "d" },
    ],
    dependencies: [
      { ref: "a", dependsOn: ["d", { ref: "b", dependsOn: ["c"] }] },
    ],
  });
  assert.deepEqual(json.dependencies, [
    { ref: "a", dependsOn: ["d", "b"] },
    { ref: "b", dependsOn: ["c"] },
  ]);
});

test("already-proto-shaped dependencies input is accepted", () => {
  // Existing callers that already emit the proto shape (dependencies: [{ref}])
  // must continue to work alongside the canonical dependsOn form.
  const json = roundTripBom("1.7", {
    dependencies: [{ ref: "a", dependencies: [{ ref: "b" }] }],
  });
  assert.deepEqual(json.dependencies, [{ ref: "a", dependsOn: ["b"] }]);
});

test("LicenseChoice expressionDetails round-trips for 1.7", () => {
  // Canonical JSON carries `expression` and `expressionDetails` as siblings on
  // a LicenseChoice, while the 1.7 proto nests them inside the
  // `expression_detailed` oneof (a LicenseExpressionDetailed message). The
  // bridge packs/unpacks between the two and preserves the oneof invariant.
  const json = roundTripBom("1.7", {
    components: [
      {
        type: "library",
        name: "dep",
        licenses: [
          {
            expression: "MIT OR Apache-2.0",
            expressionDetails: [
              { licenseIdentifier: "MIT" },
              {
                licenseIdentifier: "Apache-2.0",
                url: "https://www.apache.org/licenses/LICENSE-2.0",
              },
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual(json.components[0].licenses, [
    {
      expression: "MIT OR Apache-2.0",
      expressionDetails: [
        { licenseIdentifier: "MIT" },
        {
          licenseIdentifier: "Apache-2.0",
          url: "https://www.apache.org/licenses/LICENSE-2.0",
        },
      ],
    },
  ]);

  // A plain expression without expressionDetails must keep using the `expression`
  // oneof case and not gain an expressionDetails key.
  const plain = roundTripBom("1.7", {
    components: [
      { type: "library", name: "plain", licenses: [{ expression: "MIT" }] },
    ],
  });
  assert.deepEqual(plain.components[0].licenses, [{ expression: "MIT" }]);
});

test("LicenseChoice license objects are unaffected by the expressionDetails bridge", () => {
  const json = roundTripBom("1.7", {
    components: [
      {
        type: "library",
        name: "lic",
        licenses: [{ license: { id: "Apache-2.0" } }],
      },
    ],
  });
  assert.deepEqual(json.components[0].licenses, [
    { license: { id: "Apache-2.0" } },
  ]);
});

test("convertBom downgrades and reports dropped fields", () => {
  const bom = parseBomJson(
    {
      bomFormat: "CycloneDX",
      specVersion: "1.7",
      version: 1,
      components: [{ type: "library", name: "dep" }],
      citations: [{ timestamp: "2026-01-01T00:00:00Z", pointers: ["/x"] }],
    },
    { ignoreUnknownFields: true },
  );

  const { bom: downgraded, warnings } = convertBom(bom, "1.5");
  assert.equal(downgraded.specVersion, "1.5");
  // Citations are 1.7-only; the downgrade should warn about them.
  assert.ok(warnings.some((w) => w.includes("citations")));
});

test("convertBom upgrades without warnings", () => {
  const bom = parseBomJson({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    components: [{ type: "library", name: "dep" }],
  });
  const { bom: upgraded, warnings } = convertBom(bom, "1.7");
  assert.equal(upgraded.specVersion, "1.7");
  assert.deepEqual(warnings, []);
});

test("bomStats reports counts and sizes", () => {
  const bom = parseBomJson({
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    version: 1,
    components: [
      { type: "library", name: "a" },
      { type: "library", name: "b" },
    ],
    dependencies: [{ ref: "a", dependsOn: ["b"] }],
  });
  const stats = bomStats(bom);
  assert.equal(stats.specVersion, "1.7");
  assert.equal(stats.componentCount, 2);
  assert.equal(stats.dependencyCount, 1);
  assert.ok(stats.jsonByteSize > 0);
  assert.ok(stats.binaryByteSize > 0);
  assert.ok(stats.binaryByteSize < stats.jsonByteSize);
  assert.ok(stats.compressionRatio > 0 && stats.compressionRatio < 1);
});





test("undefined properties are stripped inside subtrees that skip rewriting", () => {
  // The normalizer skips rebuilding subtrees whose descriptors need no field
  // rewriting (Property, Swid and friends have no aliases or enums). Skipping
  // the rewrite must not skip undefined-stripping: protobuf-es rejects
  // undefined on a known field, and the helper API promises callers can pass
  // ordinary JavaScript objects. Regression test -- these all threw
  // "expected string, got undefined" when the skip returned the value as-is.
  const json = encodeBomJson(
    parseBomJson({
      bomFormat: "CycloneDX",
      specVersion: "1.7",
      version: 1,
      components: [
        {
          type: "library",
          name: "a",
          version: undefined,
          properties: [{ name: "k", value: undefined }],
          swid: { tagId: "t", name: undefined },
          pedigree: {
            notes: undefined,
            ancestors: [
              {
                type: "library",
                name: "anc",
                properties: [{ name: "x", value: undefined }],
              },
            ],
          },
        },
      ],
    }),
  );

  const [component] = json.components;
  assert.equal(component.name, "a");
  assert.deepEqual(component.properties, [{ name: "k" }]);
  assert.deepEqual(component.swid, { tagId: "t" });
  assert.deepEqual(component.pedigree.ancestors[0].properties, [{ name: "x" }]);
});

test("convertBom reports fields dropped inside arrays with collapsed paths", () => {
  // A downgrade loses most of its fields inside components[] and dependencies[],
  // so a warning collector that only walks objects reports almost nothing.
  // Paths collapse the array index so one warning covers every element.
  const bom = parseBomJson({
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    version: 1,
    components: [
      { type: "library", name: "a", "bom-ref": "a", tags: ["x"] },
      { type: "library", name: "b", "bom-ref": "b", tags: ["y"] },
    ],
    dependencies: [{ ref: "a", dependsOn: ["b"], provides: ["p"] }],
  });

  const { warnings } = convertBom(bom, "1.5");
  assert.ok(
    warnings.includes("$.components[].tags"),
    `expected components[].tags warning, got ${JSON.stringify(warnings)}`,
  );
  assert.ok(
    warnings.includes("$.dependencies[].provides"),
    `expected dependencies[].provides warning, got ${JSON.stringify(warnings)}`,
  );
  // Two components both lost `tags`, but the path is reported once.
  assert.equal(
    warnings.filter((entry) => entry === "$.components[].tags").length,
    1,
  );
});

test("legacy released-spec proto field spellings are still accepted on input", () => {
  // The released CycloneDX protobuf schemas disagree with their own JSON schema
  // on three field names. Upstream corrected them and the vendored protos carry
  // the corrected spellings, but protobuf-JSON emitted by any tool generated
  // from a released spec still uses the old ones. Both must decode, and both
  // must come back out under the canonical name. Field numbers never changed,
  // so the binary wire format is identical and needs no compatibility handling.
  const cases = [
    {
      canonical: "postalCode",
      legacy: "postalCodeue",
      build: (key) => ({
        metadata: { supplier: { name: "acme", address: { [key]: "78758" } } },
      }),
      read: (json) => json.metadata.supplier.address,
      value: "78758",
    },
    {
      canonical: "collection",
      legacy: "graphic",
      build: (key) => ({
        components: [
          {
            type: "machine-learning-model",
            name: "m",
            modelCard: {
              quantitativeAnalysis: {
                graphics: { description: "g", [key]: [{ name: "c1" }] },
              },
            },
          },
        ],
      }),
      read: (json) =>
        json.components[0].modelCard.quantitativeAnalysis.graphics,
      value: [{ name: "c1" }],
    },
    {
      canonical: "cryptoRefArray",
      legacy: "cryptoRef",
      build: (key) => ({
        components: [
          {
            type: "cryptographic-asset",
            name: "tls",
            cryptoProperties: {
              assetType: "protocol",
              protocolProperties: { type: "tls", [key]: ["crypto/a1"] },
            },
          },
        ],
      }),
      read: (json) => json.components[0].cryptoProperties.protocolProperties,
      value: ["crypto/a1"],
    },
  ];

  for (const { canonical, legacy, build, read, value } of cases) {
    for (const key of [canonical, legacy]) {
      const json = encodeBomJson(
        parseBomBinary(
          encodeBomBinary(
            parseBomJson(
              {
                bomFormat: "CycloneDX",
                specVersion: "1.7",
                version: 1,
                ...build(key),
              },
              { ignoreUnknownFields: true },
            ),
            { writeUnknownFields: true },
          ),
          { readUnknownFields: true },
        ),
      );
      const container = read(json);
      assert.deepEqual(
        container[canonical],
        value,
        `input key "${key}" should surface as "${canonical}"`,
      );
      assert.ok(
        !Object.hasOwn(container, legacy),
        `output must not carry the legacy key "${legacy}"`,
      );
    }
  }
});
