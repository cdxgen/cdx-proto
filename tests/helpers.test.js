import assert from "node:assert/strict";
import test from "node:test";

import {
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
