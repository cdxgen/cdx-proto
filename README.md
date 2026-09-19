# cdx-proto

Runtime library to serialize/deserialize CycloneDX BOM with protocol buffers. The project was generated using [protoc-gen-es](https://github.com/bufbuild/protobuf-es) from the official [proto](https://github.com/CycloneDX/specification/blob/master/schema/bom-1.5.proto) specification.

## 2.0.0 highlights

- version-specific subpath exports: `@cdxgen/cdx-proto/v1.5`, `v1.6`, and `v1.7`
- helper APIs for schema selection and BOM encode/decode workflows
- leaner npm package contents that no longer publish generated `docs/`

## Sample usage

```js
import {
  createBom,
  decodeBomBinary,
  encodeBomBinary,
  encodeBomJson,
  getBomSchema,
  parseBomJson,
} from "@cdxgen/cdx-proto";
import { BomSchema as BomSchema16 } from "@cdxgen/cdx-proto/v1.6";
import { fromJson } from "@bufbuild/protobuf";

// Use version-specific entrypoints when you only need one schema version.
const bom16 = fromJson(BomSchema16, {
  specVersion: "1.6",
  version: 1,
});

// Or use the helper API to auto-select schemas and encode/decode BOMs.
const bom = createBom("1.7", {
  version: 1,
  serialNumber: "urn:uuid:11111111-1111-1111-1111-111111111111",
});

const binary = encodeBomBinary(bom, {
  writeUnknownFields: true,
});

const decoded = decodeBomBinary("1.7", binary, {
  readUnknownFields: true,
});

const json = encodeBomJson(decoded, {
  alwaysEmitImplicit: true,
});

const parsed = parseBomJson({
  specVersion: "1.6",
  version: 1,
});

const schema = getBomSchema(parsed.specVersion);
```

### Helper API

- `getBomSchema(specVersion)` returns the matching `BomSchema` for CycloneDX `1.5`, `1.6`, or `1.7`.
- `createBom(specVersion, init)` creates a BOM message and automatically sets `specVersion`.
- `parseBomJson(json)` and `parseBomJsonString(json)` auto-detect the schema from `specVersion` / `spec_version`.
- `decodeBomBinary(specVersion, bytes)` decodes a protobuf BOM when the schema version is known.
- `encodeBomBinary(bom)`, `encodeBomJson(bom)`, and `encodeBomJsonString(bom)` choose the correct schema from the BOM itself.
- `toBomMessage(value, specVersion?, options?)` is the single entry point for "turn whatever I have into a BOM message": decoded messages pass through (see `isBomMessage`), JSON strings are parsed, canonical JSON objects are dispatched by embedded version (or the fallback version, which defaults to the latest supported), and absent input yields an empty BOM. This replaces the input-dispatch re-implementations consumers previously carried.
- `isBomMessage(value)` is a type guard for a decoded BOM message of any supported spec version, keyed on `$typeName` rather than duck-typed shape.
- `convertBom(bom, targetSpecVersion)` cross-converts between spec versions. Returns `{ bom, warnings }` where `warnings` lists field paths dropped during a lossy downgrade. Fields that change cardinality between versions (`metadata.licenses` and `components[].evidence.identity`, singular in 1.5 and an array since 1.6) are reshaped automatically — wrapped on upgrade, collapsed to their first entry on downgrade with the dropped siblings reported in `warnings` — so conversions across the 1.5/1.6 boundary no longer throw. Upgrades typically produce no warnings.
- `bomStats(bom)` returns component/dependency counts and JSON/binary byte sizes with the compression ratio.
- `detectBomSpecVersion(value)` reads the spec version from a BOM object or message.
- `normalizeSpecVersion(specVersion)` normalizes `"v1.6"`, `1.6`, and `"1.6.0"` spellings to a canonical supported version, throwing for anything else; `isSupportedSpecVersion(value)` is its non-throwing probe.
- `encodeBomBase64(bom)` produces a base64 string of the protobuf binary, for contexts that cannot carry raw bytes (OCI labels, in-toto predicates, environment variables). `decodeBomBase64(specVersion, string)` decodes with a known version and `parseBomBase64(string)` auto-detects it, mirroring the binary helpers.

### Canonical JSON guarantees

The helper layer is designed to work with canonical CycloneDX JSON rather than protobuf-flavored JSON.

- `parseBomJson()` and `decodeBomJson()` accept canonical CycloneDX input such as:
  - root fields like `bomFormat` and `specVersion`
  - dashed aliases such as `bom-ref`, `mime-type`, and `x-trust-boundary`
  - canonical hash content fields like `hashes[].content`
  - canonical standards/declarations objects instead of protobuf list wrappers
- Undefined object properties and undefined array entries are sanitized before protobuf parsing so callers can pass ordinary JavaScript objects without manually stripping `undefined` values first.
- `encodeBomJson()` and `encodeBomJsonString()` restore canonical CycloneDX JSON on output, including:
  - `bomFormat: "CycloneDX"`
  - the BOM `specVersion`
  - canonical enum values instead of protobuf enum names such as `CLASSIFICATION_*`, `HASH_ALG_*`, or `EXTERNAL_REFERENCE_TYPE_*`
  - canonical object shapes for `definitions` and `declarations`
  - flat `dependencies[].dependsOn: string[]` instead of the protobuf nested `dependencies` tree (see below)
- `parseBomBinary()` auto-detects the embedded supported schema version (`1.5`, `1.6`, or `1.7`) and can be paired with `encodeBomJson()` to read protobuf BOMs back as canonical CycloneDX JSON.

#### Corrected proto field names, and interop with tools that use the released ones

Three fields are named differently in the released CycloneDX protobuf schemas
than in the CycloneDX JSON schema they are supposed to mirror. The schemas
vendored here correct all three, so a protobuf BOM produced by this library uses
the same names as its JSON counterpart:

| version(s) | released proto name | corrected proto name | canonical JSON |
| --- | --- | --- | --- |
| 1.6, 1.7 | `postalCodeue` | `postalCode` | `postalCode` |
| 1.5, 1.6, 1.7 | `graphic` | `collection` | `collection` |
| 1.6, 1.7 | `cryptoRef` | `cryptoRefArray` | `cryptoRefArray` |

Interoperability is preserved in both directions:

- **Binary needs no special handling.** Every field number is unchanged, so the
  wire format is byte-identical whichever schema produced it.
- **Both JSON spellings are accepted on input.** Protobuf-JSON emitted by a tool
  generated from a released schema still uses the old names, so those decode too.
  Output always uses the canonical JSON name.

If you read these fields directly off a typed message (`cdx_16.*`, `cdx_17.*`)
rather than through the canonical JSON helpers, use the corrected names.

#### Dependency graph bridging

Canonical CycloneDX JSON expresses the dependency graph as a flat array of
`{ ref, dependsOn: [ref, ...], provides: [ref, ...] }` entries. The protobuf
mirrors the XML model and nests children as `repeated Dependency dependencies`,
so without this library's bridge the `dependsOn` key is unknown to protobuf-es
and is either rejected (default options) or silently dropped
(`ignoreUnknownFields: true`), which empties the dependency graph.

The helper layer converts between the two forms automatically:

- **JSON -> protobuf**: each `dependsOn` string becomes a nested
  `{ ref }` child under `dependencies`. Already-proto-shaped `dependencies`
  arrays and mixed arrays of strings/objects are also accepted.
- **protobuf -> JSON**: nested `dependencies` are flattened back into
  `dependsOn`. If a nested entry carries its own edges (its own `dependencies`
  or `provides`), it is hoisted to a sibling top-level entry so transitive
  edges are never lost. Entries are de-duplicated by `ref`.


In short: if you provide canonical CycloneDX JSON to the helper API, you should get canonical CycloneDX JSON back after binary or message round-trips.

### Version-specific imports

Use subpath exports to avoid loading schema versions you do not need:

```js
import { BomSchema as BomSchema15 } from "@cdxgen/cdx-proto/v1.5";
import { BomSchema as BomSchema16 } from "@cdxgen/cdx-proto/v1.6";
import { BomSchema as BomSchema17 } from "@cdxgen/cdx-proto/v1.7";
```

### Node-only file helpers

`@cdxgen/cdx-proto/node` adds filesystem convenience wrappers without
polluting the main (browser-safe) entry with `node:` imports:

```js
import {
  isProtoBomFile,
  readBomFile,
  writeBomFile,
} from "@cdxgen/cdx-proto/node";

// Format is auto-detected from the extension: `.json` for canonical JSON,
// `.b64`/`.base64` for base64 protobuf payloads, and anything else
// (`.cdx`, `.cdx.bin`, `.proto`, `.bin`, ...) as raw protobuf binary.
const bom = readBomFile("bom.cdx");
const bomJson = readBomFile("bom.cdx", { asJson: true });

writeBomFile("bom.json", bom); // pretty canonical JSON
writeBomFile("bom.cdx", bomJson); // coerced back to a message, then binary
writeBomFile("bom.b64", bom); // base64 protobuf payload

isProtoBomFile("bom.CDX.BIN"); // true — the extension list lives here once
```

## CLI

The package ships a zero-dependency `cdx-proto` CLI for converting, inspecting,
and validating BOMs from the shell. The format is auto-detected by file
extension (`.json` for canonical JSON, `.b64`/`.base64` for base64 protobuf,
anything else for protobuf binary).

```sh
# Convert JSON to protobuf binary (~2x smaller for typical BOMs)
npx cdx-proto convert bom.json bom.bin

# Downgrade a 1.7 BOM to 1.5, warning about dropped fields
npx cdx-proto convert bom.json bom-1.5.json --to 1.5

# Convert to a base64 payload for embedding in labels or predicates
npx cdx-proto convert bom.json bom.b64

# Inspect component/dependency counts and byte sizes
npx cdx-proto inspect bom.bin

# Validate that a file parses cleanly
npx cdx-proto validate bom.json
```

## License

MIT
