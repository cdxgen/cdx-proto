// Deterministic synthetic CycloneDX BOM generator for benchmarking.
//
// Produces canonical CycloneDX JSON with `bom-ref`, `hashes[].content`,
// `licenses[].license.id`, and `properties[]` on each component plus a
// `dependencies[]` graph. No Math.random — output is stable across runs so
// benchmark numbers are comparable.
//
// Usage:
//   import { makeSyntheticBom } from "./bench/fixtures.mjs";
//   const bomJson = makeSyntheticBom({ specVersion: "1.7", components: 1000, deps: 1000 });

const LICENSE_IDS = [
  "MIT",
  "Apache-2.0",
  "BSD-3-Clause",
  "ISC",
  "GPL-3.0-only",
  "MPL-2.0",
];

const COMPONENT_TYPES = ["library", "application", "framework"];

/**
 * Builds a canonical CycloneDX BOM JSON object with the requested number of
 * components and dependency edges.
 *
 * @param {object} opts
 * @param {string} [opts.specVersion="1.7"]
 * @param {number} [opts.components=1000]  — number of components to generate
 * @param {number} [opts.deps]             — number of dependency entries (defaults to components)
 * @returns {object} canonical CycloneDX JSON
 */
export function makeSyntheticBom({
  specVersion = "1.7",
  components = 1000,
  deps,
} = {}) {
  const dependencyCount = deps ?? components;
  const bomComponents = [];
  for (let i = 0; i < components; i += 1) {
    const licenseId = LICENSE_IDS[i % LICENSE_IDS.length];
    const type = COMPONENT_TYPES[i % COMPONENT_TYPES.length];
    bomComponents.push({
      type,
      "bom-ref": `pkg:npm/pkg-${i}@${i}.0.0`,
      name: `pkg-${i}`,
      version: `${i}.0.0`,
      hashes: [
        { alg: "SHA-256", content: `${"a".repeat(64 - 4)}${String(i).padStart(4, "0")}` },
      ],
      licenses: [{ license: { id: licenseId } }],
      properties: [
        { name: `cdx:audit:${i}`, value: `scan-${i}` },
        { name: "cdx:source", value: "synthetic" },
      ],
    });
  }

  const dependencies = [];
  for (let i = 0; i < dependencyCount; i += 1) {
    const ref = `pkg:npm/pkg-${i}@${i}.0.0`;
    const dependsOn =
      i + 1 < components
        ? [`pkg:npm/pkg-${i + 1}@${i + 1}.0.0`]
        : [];
    dependencies.push({ ref, dependsOn });
  }

  return {
    bomFormat: "CycloneDX",
    specVersion,
    version: 1,
    serialNumber: "urn:uuid:11111111-1111-1111-1111-111111111111",
    components: bomComponents,
    dependencies,
  };
}
