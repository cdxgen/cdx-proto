// Diffs the vendored specification/*.proto files against an upstream CycloneDX
// specification checkout and reports any difference that is not on the
// intentional-divergence allowlist below. Intentional divergences are documented
// inline in the vendored .proto files (search for "LOCAL PATCH").
//
// Usage: node scripts/check-spec-drift.mjs [path-to-upstream-schema-dir]
//        CDX_SPEC_UPSTREAM=/path/to/specification/schema npm run spec:drift
//
// When the upstream checkout is not present the check reports SKIPPED and exits
// 0, so CI without the checkout does not fail. Exit code 1 means real drift was
// found, or that the upstream directory was given but could not be read.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
const explicitUpstream = process.env.CDX_SPEC_UPSTREAM ?? process.argv[2];
const upstreamDir =
  explicitUpstream ?? `${workspacePath}../../cyclonedx/specification/schema`;

const versions = ["1.5", "1.6", "1.7"];

// Each entry is a substring that, if present on a diff line, is treated as an
// expected divergence.
//
// The vendored protos currently match the upstream `fix/proto-schema-bugs`
// branch, which corrects six long-standing mismatches between the protobuf
// schemas and the CycloneDX JSON schema/XSD they mirror: three 1.5 cardinality
// errors, and three field names. Until that branch merges and ships, diffing
// against upstream `master` reports those corrections as drift — so both
// spellings of each are listed here in pairs. Delete a pair once the
// corresponding fix is released upstream; the check tightens automatically.
const allowlist = [
  // 1.5 Component.evidence: single object per the 1.5 JSON schema and XSD
  "optional Evidence evidence = 23;",
  "repeated Evidence evidence = 23;",
  // 1.5 Evidence.identity: single object until 1.6 made it object-or-array
  "optional EvidenceIdentity identity = 3;",
  "repeated EvidenceIdentity identity = 3;",
  // 1.5 Component.data: an array per the JSON schema (already fixed in 1.6+)
  "repeated ComponentData data = 26;",
  "optional ComponentData data = 26;",
  // 1.6/1.7 PostalAddressType.postalCode: `postalCodeue` was a typo
  "optional string postalCodeue = 6;",
  "optional string postalCode = 6;",
  // 1.5/1.6/1.7 GraphicsCollection.collection: JSON schema calls it `collection`
  "repeated Graphic graphic = 2;",
  "repeated Graphic collection = 2;",
  // 1.6/1.7 ProtocolProperties.cryptoRefArray: JSON schema name
  "repeated string cryptoRef = 5;",
  "repeated string cryptoRefArray = 5;",
  // Cosmetic package-line version comments (kept from upstream either way)
  "package cyclonedx.v1_5; // 1.5.1",
  "package cyclonedx.v1_6; // version 1.6.2",
  "package cyclonedx.v1_7; // 1.7.1",
];

const missing = versions.filter(
  (version) => !existsSync(`${upstreamDir}/bom-${version}.proto`),
);

if (missing.length > 0) {
  // An explicitly supplied path that does not resolve is a usage error; an
  // absent default checkout is not something to fail the build over.
  const stream = explicitUpstream ? console.error : console.log;
  stream(
    `SKIPPED: no upstream CycloneDX schema at ${upstreamDir} (missing bom-${missing.join(", bom-")}.proto).`,
  );
  stream(
    "Set CDX_SPEC_UPSTREAM or pass the upstream schema directory to run the drift check.",
  );
  process.exit(explicitUpstream ? 1 : 0);
}

let drifted = false;

for (const version of versions) {
  const file = `bom-${version}.proto`;
  let diff;
  try {
    diff = execFileSync(
      "diff",
      [`${workspacePath}specification/${file}`, `${upstreamDir}/${file}`],
      { encoding: "utf8" },
    );
  } catch (error) {
    // diff exits 1 when the files differ and >1 on a real error. Anything other
    // than "files differ" means the comparison did not happen, which must fail
    // loudly rather than silently pass.
    if (error.status !== 1) {
      console.error(`Could not diff ${file} against ${upstreamDir}:`);
      console.error(`  ${error.stderr?.trim() || error.message}`);
      process.exit(1);
    }
    diff = error.stdout ?? "";
  }

  if (!diff) {
    continue;
  }

  // Keep only the "< ..." / "> ..." content lines, strip the diff markers, and
  // drop anything matching an allowlist entry.
  const unexpected = diff
    .split("\n")
    .filter((line) => line.startsWith("<") || line.startsWith(">"))
    .map((line) => line.slice(2))
    .filter((line) => line.trim() !== "")
    .filter((line) => !allowlist.some((allowed) => line.includes(allowed)));

  // Comment-only differences are cosmetic and should not fail the check.
  const substantive = unexpected.filter(
    (line) => !line.trim().startsWith("//"),
  );

  if (substantive.length > 0) {
    drifted = true;
    console.error(`Unexpected drift in ${file}:`);
    for (const line of substantive) {
      console.error(`  ${line}`);
    }
  }
}

if (drifted) {
  console.error(
    "\nSpecification drift detected. Either re-sync from upstream or, if the divergence is intentional, document it with a LOCAL PATCH comment and add it to the allowlist in scripts/check-spec-drift.mjs.",
  );
  process.exit(1);
}

console.log(`No unexpected specification drift detected (upstream: ${upstreamDir}).`);
