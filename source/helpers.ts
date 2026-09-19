import type {
  BinaryReadOptions,
  BinaryWriteOptions,
  JsonReadOptions,
  JsonValue,
  JsonWriteOptions,
  JsonWriteStringOptions,
  MessageInitShape,
  MessageJsonType,
} from "@bufbuild/protobuf";
import {
  create,
  fromBinary,
  fromJson,
  toBinary,
  toJson,
} from "@bufbuild/protobuf";
import { base64Decode, base64Encode } from "@bufbuild/protobuf/wire";

import type { Bom as Bom15 } from "./lib/bom-1.5_pb.js";
import { BomSchema as BomSchema15 } from "./lib/bom-1.5_pb.js";
import type { Bom as Bom16 } from "./lib/bom-1.6_pb.js";
import { BomSchema as BomSchema16 } from "./lib/bom-1.6_pb.js";
import type { Bom as Bom17 } from "./lib/bom-1.7_pb.js";
import { BomSchema as BomSchema17 } from "./lib/bom-1.7_pb.js";

export const supportedSpecVersions = ["1.5", "1.6", "1.7"] as const;

export type SupportedSpecVersion = (typeof supportedSpecVersions)[number];

export type BomSchemaByVersion = {
  "1.5": typeof BomSchema15;
  "1.6": typeof BomSchema16;
  "1.7": typeof BomSchema17;
};

export type BomByVersion = {
  "1.5": Bom15;
  "1.6": Bom16;
  "1.7": Bom17;
};

export type BomInitByVersion = {
  [Version in SupportedSpecVersion]: MessageInitShape<
    BomSchemaByVersion[Version]
  >;
};

export type BomJsonByVersion = {
  [Version in SupportedSpecVersion]: MessageJsonType<
    BomSchemaByVersion[Version]
  >;
};

export type AnyBomSchema = BomSchemaByVersion[SupportedSpecVersion];
export type AnyBom = BomByVersion[SupportedSpecVersion];
export type AnyBomJson = BomJsonByVersion[SupportedSpecVersion];

type JsonLike = unknown;
type JsonRecord = Record<string, unknown>;
type EnumMapPair = {
  canonicalToProto: Map<string, string>;
  protoToCanonical: Map<string, string | undefined>;
};
type EnumValueDescriptorLike = {
  name: string;
};
type EnumDescriptorLike = {
  name: string;
  sharedPrefix?: string;
  typeName: string;
  values: EnumValueDescriptorLike[];
};
type FieldDescriptorLike = {
  enum?: EnumDescriptorLike;
  fieldKind: string;
  jsonName: string;
  listKind?: string;
  localName: string;
  mapKind?: string;
  message?: MessageDescriptorLike;
  name: string;
};
type MessageDescriptorLike = {
  fields: FieldDescriptorLike[];
  name: string;
};
type NormalizationDirection = "fromProto" | "toProto";

type BomVersionCarrier = {
  specVersion?: unknown;
  spec_version?: unknown;
};

const bomSchemas: BomSchemaByVersion = {
  "1.5": BomSchema15,
  "1.6": BomSchema16,
  "1.7": BomSchema17,
};

// The latest entry of supportedSpecVersions; the ?? is only for the
// noUncheckedIndexedAccess index type — the array is a non-empty const.
const latestSupportedSpecVersion =
  supportedSpecVersions[supportedSpecVersions.length - 1] ?? "1.7";

const bomMessageTypeNames = new Set<string>(
  (Object.values(bomSchemas) as AnyBomSchema[]).map(
    (schema) => schema.typeName,
  ),
);

const SUPPORTED_BINARY_READ_ORDER = [...supportedSpecVersions].reverse();

const FIELD_ALIASES: Record<string, string> = {
  bomRef: "bom-ref",
  mimeType: "mime-type",
  xTrustBoundary: "x-trust-boundary",
};

const MESSAGE_FIELD_ALIASES: Record<string, string> = {
  "CommonExtension.name": "commonExtensionName",
  "CommonExtension.value": "commonExtensionValue",
  "CustomExtension.name": "customExtensionName",
  "CustomExtension.value": "customExtensionValue",
  "DistributionConstraints.tlp": "tlpClassification",
  "Hash.value": "content",
  "LicenseExpressionDetailed.details": "expressionDetails",
};

/**
 * Extra JSON keys accepted on input, keyed by `<Message>.<localName>`. Unlike
 * {@link MESSAGE_FIELD_ALIASES} these never change what is written back out —
 * they only widen what the decoder recognises.
 *
 * The three entries below are the field names used by the *released* CycloneDX
 * protobuf schemas, which disagree with their own JSON schema and XSD. The
 * vendored protos here carry corrected names (`postalCodeue` -> `postalCode`,
 * `graphic` -> `collection`, `cryptoRef` -> `cryptoRefArray`) so that canonical
 * output is right without an alias — see the LOCAL PATCHES header in each
 * `specification/bom-*.proto`.
 *
 * That correction is local to this package, so anything generated from a
 * released schema — which is every other protobuf implementation — still emits
 * the old spellings. Without this table those fields would be silently dropped
 * on input, so it is a permanent part of the bridge rather than a migration aid.
 *
 * Only the JSON *names* differ: every field number is unchanged, so the binary
 * wire format is identical in both directions and needs no compatibility
 * handling.
 */
const LEGACY_FIELD_INPUT_ALIASES: Record<string, readonly string[]> = {
  "GraphicsCollection.collection": ["graphic"],
  "PostalAddressType.postalCode": ["postalCodeue"],
  "ProtocolProperties.cryptoRefArray": ["cryptoRef"],
};

const ENUM_CANONICAL_STYLE_OVERRIDES: Record<string, string> = {
  Aggregate: "lower-underscore",
  CO2MeasureUnitType: "co2-measure-unit",
  CommonExtensionName: "lower-camel",
  CryptoImplementationPlatform: "implementation-platform",
  EnergyMeasureUnitType: "energy-measure-unit",
  EvidenceFieldType: "lower-camel",
  HashAlg: "hash-algorithm",
  ImpactAnalysisJustification: "lower-underscore",
  ImpactAnalysisState: "lower-underscore",
  ScoreMethod: "score-method",
  TlpClassification: "upper-underscore",
  VulnerabilityAffectedStatus: "lower-underscore",
  VulnerabilityResponse: "lower-underscore",
};

const SPECIAL_ENUM_CANONICAL_VALUES: Record<string, Record<string, string>> = {
  CO2MeasureUnitType: {
    TONNES_CO2_EQUIVALENT: "tCO2eq",
  },
  CryptoImplementationPlatform: {
    ARMV7_A: "armv7-a",
    ARMV7_M: "armv7-m",
    ARMV8_A: "armv8-a",
    ARMV8_M: "armv8-m",
    ARMV9_A: "armv9-a",
    ARMV9_M: "armv9-m",
    GENERIC: "generic",
    OTHER: "other",
    PPC64: "ppc64",
    PPC64LE: "ppc64le",
    S390X: "s390x",
    UNKNOWN: "unknown",
    X86_32: "x86_32",
    X86_64: "x86_64",
  },
  EnergyMeasureUnitType: {
    KILOWATT_HOURS: "kWh",
  },
  HashAlg: {
    BLAKE_2_B_256: "BLAKE2b-256",
    BLAKE_2_B_384: "BLAKE2b-384",
    BLAKE_2_B_512: "BLAKE2b-512",
    BLAKE_3: "BLAKE3",
    MD_5: "MD5",
    SHA_1: "SHA-1",
    SHA_256: "SHA-256",
    SHA_384: "SHA-384",
    SHA_3_256: "SHA3-256",
    SHA_3_384: "SHA3-384",
    SHA_3_512: "SHA3-512",
    SHA_512: "SHA-512",
    STREEBOG_256: "STREEBOG_256",
    STREEBOG_512: "STREEBOG_512",
  },
  ScoreMethod: {
    CVSSV2: "CVSSv2",
    CVSSV3: "CVSSv3",
    CVSSV31: "CVSSv31",
    CVSSV4: "CVSSv4",
    OTHER: "other",
    OWASP: "OWASP",
    SSVC: "SSVC",
  },
};

const enumMapCache = new WeakMap<EnumDescriptorLike, EnumMapPair>();

const BOM_OBJECT_WRAPPED_LIST_FIELDS = new Set(["declarations", "definitions"]);

function isJsonRecord(value: JsonLike): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shouldWrapBomObjectListField(
  messageDescriptor: MessageDescriptorLike,
  fieldDescriptor: FieldDescriptorLike,
): boolean {
  return (
    messageDescriptor.name === "Bom" &&
    BOM_OBJECT_WRAPPED_LIST_FIELDS.has(fieldDescriptor.jsonName)
  );
}

/**
 * Detects a "scalar list wrapper" message: a message that exists only to carry
 * a single `repeated string` field, such as `Citation.Pointers` (inner field
 * `pointer`) and `Citation.Expressions` (inner field `expression`). In the
 * canonical CycloneDX JSON these are represented as bare string arrays under
 * the wrapper's plural key, whereas the protobuf representation nests the array
 * inside the wrapper message. Returns the inner field descriptor when the
 * message matches the shape, so callers can wrap/unwrap the value.
 *
 * The test is structural rather than a list of message names so it holds for
 * every spec version without maintenance. Across all bundled specifications
 * the only messages of this shape are `Citation.Pointers` and
 * `Citation.Expressions`.
 */
function getScalarListWrapperInnerField(
  messageDescriptor: MessageDescriptorLike,
): FieldDescriptorLike | undefined {
  if (messageDescriptor.fields.length !== 1) {
    return undefined;
  }
  const [field] = messageDescriptor.fields;
  if (
    field !== undefined &&
    field.fieldKind === "list" &&
    field.listKind === "scalar"
  ) {
    return field;
  }
  return undefined;
}

/**
 * Moves a scalar list between its two representations: a bare array in
 * canonical CycloneDX JSON, and an array nested inside a wrapper message in
 * protobuf. An absent or malformed wrapper unwraps to an empty array rather
 * than to the wrapper object, so a round-trip never leaves an object where the
 * CycloneDX schema requires an array.
 */
function transformScalarListWrapper(
  messageDescriptor: MessageDescriptorLike,
  value: JsonLike,
  direction: NormalizationDirection,
): JsonLike {
  const innerField = getScalarListWrapperInnerField(messageDescriptor);
  if (!innerField) {
    return value;
  }
  if (direction === "toProto") {
    const wrapped = Array.isArray(value)
      ? ({ [innerField.jsonName]: value } as JsonRecord)
      : value;
    return transformMessageValue(messageDescriptor, wrapped, direction);
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (isJsonRecord(value)) {
    const inner = value[innerField.jsonName];
    return Array.isArray(inner) ? inner : [];
  }
  return value;
}

function mergeBomObjectListEntries(entries: JsonLike[]): JsonLike {
  const mergedEntry: JsonRecord = {};
  for (const entry of entries) {
    if (!isJsonRecord(entry)) {
      continue;
    }
    for (const [key, value] of Object.entries(entry)) {
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        mergedEntry[key] = [
          ...((mergedEntry[key] as JsonLike[]) || []),
          ...value,
        ];
        continue;
      }
      if (isJsonRecord(value) && isJsonRecord(mergedEntry[key])) {
        mergedEntry[key] = {
          ...(mergedEntry[key] as JsonRecord),
          ...value,
        };
        continue;
      }
      if (mergedEntry[key] === undefined) {
        mergedEntry[key] = value;
      }
    }
  }
  return Object.keys(mergedEntry).length ? mergedEntry : undefined;
}

const specVersionCache = new Map<string | number, SupportedSpecVersion>();

/**
 * Normalizes a CycloneDX spec version to one of {@link supportedSpecVersions}.
 * Accepts the canonical strings ("1.5", "1.6", "1.7") plus the spellings seen
 * in the wild: `v`-prefixed ("v1.6"), numeric (1.6), and patch-suffixed
 * ("1.6.0"). Throws for anything else.
 *
 * Exported because every consumer that has to answer "can I proto-serialize
 * this BOM?" needs the same parsing rules; without it, consumers re-implement
 * version normalization (cdxgen carries `toCycloneDxSpecVersionString` for
 * exactly this reason).
 */
export function normalizeSpecVersion(
  specVersion: string | number,
): SupportedSpecVersion {
  const cached = specVersionCache.get(specVersion);
  if (cached !== undefined) {
    return cached;
  }
  // Fast-path the exact canonical strings before the regex.
  if (specVersion === "1.5" || specVersion === "1.6" || specVersion === "1.7") {
    specVersionCache.set(specVersion, specVersion);
    return specVersion;
  }
  const normalized = String(specVersion).trim().toLowerCase().replace(/^v/, "");
  const match = /^(1\.[567])(?:\.0+)?$/.exec(normalized);
  if (match) {
    const result = match[1] as SupportedSpecVersion;
    specVersionCache.set(specVersion, result);
    return result;
  }

  throw new Error(
    `Unsupported CycloneDX spec version: ${String(specVersion)}. Supported versions: ${supportedSpecVersions.join(", ")}`,
  );
}

/**
 * Non-throwing companion to {@link normalizeSpecVersion}: `true` when the value
 * is a string or number that normalizes to a supported spec version. Consumers
 * gating protobuf operations on version support (cdxgen's
 * `isProtoSupportedSpecVersion`) can delegate to this instead of matching
 * against `supportedSpecVersions` by hand.
 */
export function isSupportedSpecVersion(
  specVersion: unknown,
): specVersion is string | number {
  if (typeof specVersion !== "string" && typeof specVersion !== "number") {
    return false;
  }
  try {
    normalizeSpecVersion(specVersion);
    return true;
  } catch {
    return false;
  }
}

function readSpecVersion(value: BomVersionCarrier): SupportedSpecVersion {
  const candidate = value.specVersion ?? value.spec_version;
  if (typeof candidate !== "string" && typeof candidate !== "number") {
    throw new Error(
      "Unable to determine CycloneDX spec version. Expected a 'specVersion' or 'spec_version' field.",
    );
  }

  return normalizeSpecVersion(candidate);
}

function assertMatchingSpecVersion(
  expected: SupportedSpecVersion,
  value: BomVersionCarrier,
): void {
  const actual = readSpecVersion(value);
  if (actual !== expected) {
    throw new Error(
      `CycloneDX spec version mismatch: expected ${expected}, received ${actual}.`,
    );
  }
}

function toLowerCamelCase(value: string): string {
  const [firstPart = "", ...rest] = value.toLowerCase().split("_");
  return `${firstPart}${rest
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("")}`;
}

function getEnumPrefix(enumDescriptor: EnumDescriptorLike): string {
  if (typeof enumDescriptor.sharedPrefix === "string") {
    return enumDescriptor.sharedPrefix.toUpperCase();
  }

  const [firstName = ""] = enumDescriptor.values.map((entry) => entry.name);
  let prefix = firstName;
  for (const enumValue of enumDescriptor.values) {
    let index = 0;
    while (
      index < prefix.length &&
      index < enumValue.name.length &&
      prefix[index] === enumValue.name[index]
    ) {
      index += 1;
    }
    prefix = prefix.slice(0, index);
  }

  const separatorIndex = prefix.lastIndexOf("_");
  return separatorIndex === -1 ? "" : prefix.slice(0, separatorIndex + 1);
}

function enumSuffixToCanonical(
  enumDescriptor: EnumDescriptorLike,
  suffix: string,
): string | undefined {
  if (suffix === "NULL" || suffix === "UNSPECIFIED") {
    return undefined;
  }

  const specialValue =
    SPECIAL_ENUM_CANONICAL_VALUES[enumDescriptor.name]?.[suffix];
  if (specialValue !== undefined) {
    return specialValue;
  }

  switch (ENUM_CANONICAL_STYLE_OVERRIDES[enumDescriptor.name]) {
    case "lower-camel":
      return toLowerCamelCase(suffix);
    case "lower-underscore":
      return suffix.toLowerCase();
    case "upper-underscore":
      return suffix;
    default:
      return suffix.toLowerCase().replaceAll("_", "-");
  }
}

function getEnumMaps(enumDescriptor: EnumDescriptorLike): EnumMapPair {
  const cachedMaps = enumMapCache.get(enumDescriptor);
  if (cachedMaps) {
    return cachedMaps;
  }

  const prefix = getEnumPrefix(enumDescriptor);
  const canonicalToProto = new Map<string, string>();
  const protoToCanonical = new Map<string, string | undefined>();

  for (const enumValue of enumDescriptor.values) {
    const suffix = enumValue.name.startsWith(prefix)
      ? enumValue.name.slice(prefix.length)
      : enumValue.name;
    const canonicalValue = enumSuffixToCanonical(enumDescriptor, suffix);
    protoToCanonical.set(enumValue.name, canonicalValue);
    if (canonicalValue !== undefined) {
      canonicalToProto.set(canonicalValue, enumValue.name);
    }
  }

  const enumMaps = {
    canonicalToProto,
    protoToCanonical,
  };
  enumMapCache.set(enumDescriptor, enumMaps);
  return enumMaps;
}

function transformEnumValue(
  enumDescriptor: EnumDescriptorLike,
  value: JsonLike,
  direction: NormalizationDirection,
): JsonLike {
  if (typeof value !== "string") {
    return value;
  }

  const enumMaps = getEnumMaps(enumDescriptor);
  if (direction === "toProto") {
    if (enumMaps.protoToCanonical.has(value)) {
      return value;
    }
    return enumMaps.canonicalToProto.get(value) ?? value;
  }

  return enumMaps.protoToCanonical.get(value) ?? value;
}

function getFieldAlias(
  messageDescriptor: MessageDescriptorLike,
  fieldDescriptor: FieldDescriptorLike,
): string | undefined {
  return (
    MESSAGE_FIELD_ALIASES[
      `${messageDescriptor.name}.${fieldDescriptor.localName}`
    ] ?? FIELD_ALIASES[fieldDescriptor.localName]
  );
}

function getLegacyFieldInputAliases(
  messageDescriptor: MessageDescriptorLike,
  fieldDescriptor: FieldDescriptorLike,
): readonly string[] {
  return (
    LEGACY_FIELD_INPUT_ALIASES[
      `${messageDescriptor.name}.${fieldDescriptor.localName}`
    ] ?? []
  );
}

/**
 * Per-field metadata derived once from the (immutable, module-level) descriptor
 * and reused across every message instance. `inputKeys` is the full set of JSON
 * keys that resolve to this field (alias, jsonName, localName, proto name,
 * dashed name); `byInputKey` indexes them for O(1) lookup so the transform can
 * iterate the *data* keys rather than the *schema* fields.
 */
type FieldMeta = {
  descriptor: FieldDescriptorLike;
  jsonName: string;
  outputKey: string;
  inputKeys: string[];
  isBomObjectWrappedList: boolean;
};

type MessageMeta = {
  byInputKey: Map<string, FieldMeta>;
  hasExpressionDetailedField: boolean;
  needsTransform: boolean;
};

const messageMetaCache = new WeakMap<MessageDescriptorLike, MessageMeta>();

/**
 * Determines whether a message (transitively) contains any field that the
 * bridge layer must rewrite: an aliased field, an enum, a Bom-object-wrapped
 * list, a scalar-list wrapper, a `repeated Dependency` list, or the 1.7
 * LicenseChoice `expression_detailed` oneof. Messages that need no transform
 * can be passed through without rebuilding, which skips large swathes of a BOM
 * (e.g. every `properties[]` entry). Cycle-safe via the `computing` set.
 */
function computeNeedsTransform(
  messageDescriptor: MessageDescriptorLike,
  computing: Set<MessageDescriptorLike>,
): boolean {
  const cached = messageMetaCache.get(messageDescriptor);
  if (cached) {
    return cached.needsTransform;
  }
  if (computing.has(messageDescriptor)) {
    return false;
  }
  computing.add(messageDescriptor);

  for (const field of messageDescriptor.fields) {
    if (getFieldAlias(messageDescriptor, field) !== undefined) {
      return true;
    }
    // A legacy input alias is the only thing that needs rewriting on some
    // messages (PostalAddressType and GraphicsCollection are otherwise plain
    // scalars). Without this the subtree would be skipped and the legacy key
    // would fall through as an unknown property and be dropped.
    if (getLegacyFieldInputAliases(messageDescriptor, field).length > 0) {
      return true;
    }
    if (
      field.fieldKind === "enum" ||
      field.listKind === "enum" ||
      field.mapKind === "enum"
    ) {
      return true;
    }
    if (shouldWrapBomObjectListField(messageDescriptor, field)) {
      return true;
    }
    if (field.localName === "expressionDetailed") {
      return true;
    }
    if (field.message) {
      if (
        field.listKind === "message" &&
        field.message.name === "Dependency"
      ) {
        return true;
      }
      if (getScalarListWrapperInnerField(field.message)) {
        return true;
      }
      if (computeNeedsTransform(field.message, computing)) {
        return true;
      }
    }
  }
  return false;
}

function getMessageMeta(
  messageDescriptor: MessageDescriptorLike,
): MessageMeta {
  const cached = messageMetaCache.get(messageDescriptor);
  if (cached) {
    return cached;
  }

  const byInputKey = new Map<string, FieldMeta>();
  let hasExpressionDetailedField = false;

  for (const descriptor of messageDescriptor.fields) {
    if (descriptor.localName === "expressionDetailed") {
      hasExpressionDetailedField = true;
    }
    const alias = getFieldAlias(messageDescriptor, descriptor);
    const outputKey = alias ?? descriptor.jsonName;
    const inputKeys = Array.from(
      new Set(
        [
          alias,
          descriptor.jsonName,
          descriptor.localName,
          descriptor.name,
          `${descriptor.name}`.replaceAll("_", "-"),
          ...getLegacyFieldInputAliases(messageDescriptor, descriptor),
        ].filter((entry): entry is string => Boolean(entry)),
      ),
    );
    const meta: FieldMeta = {
      descriptor,
      jsonName: descriptor.jsonName,
      outputKey,
      inputKeys,
      isBomObjectWrappedList: shouldWrapBomObjectListField(
        messageDescriptor,
        descriptor,
      ),
    };
    for (const key of inputKeys) {
      byInputKey.set(key, meta);
    }
  }

  const needsTransform = computeNeedsTransform(messageDescriptor, new Set());
  const result = { byInputKey, hasExpressionDetailedField, needsTransform };
  messageMetaCache.set(messageDescriptor, result);
  return result;
}

/**
 * Bridges the CycloneDX `Dependency` representation between canonical JSON and
 * protobuf. Canonical JSON flattens the graph into entries of shape
 * `{ ref, dependsOn: [ref, ...], provides: [ref, ...] }`, while the protobuf
 * mirrors the XML model by nesting children as `repeated Dependency
 * dependencies`. Without this bridge, `dependsOn` is an unknown proto key that
 * is either rejected (default options) or silently dropped
 * (`ignoreUnknownFields: true`), emptying the dependency graph.
 */
function convertDependencyEntryToProto(entry: JsonLike): JsonLike {
  if (!isJsonRecord(entry)) {
    return entry;
  }
  const { dependsOn, dependencies, ...rest } = entry;
  const result: JsonRecord = { ...rest };
  const source = dependsOn !== undefined ? dependsOn : dependencies;
  if (source !== undefined) {
    if (Array.isArray(source)) {
      result.dependencies = source.map((item) =>
        typeof item === "string"
          ? { ref: item }
          : convertDependencyEntryToProto(item),
      );
    } else {
      result.dependencies = source;
    }
  }
  return result;
}

/**
 * Flattens a protobuf dependency tree into the canonical flat form, hoisting
 * any nested entry that carries its own edges (`dependencies`/`provides`) to a
 * sibling entry within the same array rather than dropping the transitive data.
 * Entries are de-duplicated by `ref`, merging `dependsOn` lists on collision so
 * nothing is lost when a node appears both nested and at the top level.
 */
function flattenProtoDependenciesToCanonical(deps: JsonLike[]): JsonLike {
  const result: JsonRecord[] = [];
  const byRef = new Map<string, JsonRecord>();
  const queue: JsonLike[] = [...deps];
  while (queue.length > 0) {
    const entry = queue.shift();
    if (!isJsonRecord(entry)) {
      continue;
    }
    const ref = typeof entry.ref === "string" ? entry.ref : undefined;
    const nested = Array.isArray(entry.dependencies) ? entry.dependencies : [];
    const dependsOn: string[] = [];
    for (const child of nested) {
      if (isJsonRecord(child) && typeof child.ref === "string") {
        dependsOn.push(child.ref);
        if (Array.isArray(child.dependencies) || Array.isArray(child.provides)) {
          queue.push(child);
        }
      }
    }
    const canonical: JsonRecord = { ...entry };
    delete canonical.dependencies;
    if (dependsOn.length > 0) {
      canonical.dependsOn = dependsOn;
    }
    if (ref !== undefined && byRef.has(ref)) {
      const existing = byRef.get(ref);
      if (existing !== undefined) {
        const merged = Array.isArray(existing.dependsOn)
          ? [...(existing.dependsOn as string[])]
          : [];
        for (const dep of dependsOn) {
          if (!merged.includes(dep)) {
            merged.push(dep);
          }
        }
        if (merged.length > 0) {
          existing.dependsOn = merged;
        }
      }
    } else {
      result.push(canonical);
      if (ref !== undefined) {
        byRef.set(ref, canonical);
      }
    }
  }
  return result;
}

function transformDependencyList(
  value: JsonLike,
  direction: NormalizationDirection,
): JsonLike {
  if (!Array.isArray(value)) {
    return value;
  }
  if (direction === "toProto") {
    return value.map((entry) => convertDependencyEntryToProto(entry));
  }
  return flattenProtoDependenciesToCanonical(value);
}

function transformFieldValue(
  fieldDescriptor: FieldDescriptorLike,
  value: JsonLike,
  direction: NormalizationDirection,
): JsonLike {
  switch (fieldDescriptor.fieldKind) {
    case "enum":
      if (!fieldDescriptor.enum) {
        return value;
      }
      return transformEnumValue(fieldDescriptor.enum, value, direction);
    case "list":
      if (!Array.isArray(value)) {
        return value;
      }
      // Fused sanitization: drop undefined entries in place of a separate
      // deep-clone pass.
      const defined = value.some((entry) => entry === undefined)
        ? value.filter((entry) => entry !== undefined)
        : value;
      if (fieldDescriptor.listKind === "enum" && fieldDescriptor.enum) {
        const enumDescriptor = fieldDescriptor.enum;
        return defined.map((entry) =>
          transformEnumValue(enumDescriptor, entry, direction),
        );
      }
      if (fieldDescriptor.listKind === "message" && fieldDescriptor.message) {
        if (fieldDescriptor.message.name === "Dependency") {
          return transformDependencyList(defined, direction);
        }
        const messageDescriptor = fieldDescriptor.message;
        if (!getMessageMeta(messageDescriptor).needsTransform) {
          return passThroughUntransformed(defined, direction);
        }
        return defined.map((entry) =>
          transformMessageValue(messageDescriptor, entry, direction),
        );
      }
      return defined;
    case "map":
      if (!isJsonRecord(value)) {
        return value;
      }
      if (fieldDescriptor.mapKind === "enum" && fieldDescriptor.enum) {
        const enumDescriptor = fieldDescriptor.enum;
        return Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [
            key,
            transformEnumValue(enumDescriptor, entry, direction),
          ]),
        );
      }
      if (fieldDescriptor.mapKind === "message" && fieldDescriptor.message) {
        const messageDescriptor = fieldDescriptor.message;
        return Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [
            key,
            transformMessageValue(messageDescriptor, entry, direction),
          ]),
        );
      }
      return value;
    case "message":
      if (!fieldDescriptor.message) {
        return value;
      }
      // Scalar list wrappers (e.g. Citation.Pointers/Expressions) carry a bare
      // string array in canonical JSON but nest it inside a message in proto.
      // Wrap on the way in (toProto) and unwrap on the way out (fromProto).
      if (getScalarListWrapperInnerField(fieldDescriptor.message)) {
        return transformScalarListWrapper(
          fieldDescriptor.message,
          value,
          direction,
        );
      }
      if (!getMessageMeta(fieldDescriptor.message).needsTransform) {
        return passThroughUntransformed(value, direction);
      }
      return transformMessageValue(fieldDescriptor.message, value, direction);
    default:
      return value;
  }
}

/**
 * Packs canonical LicenseChoice `{ expression, expressionDetails }` into the
 * protobuf `expression_detailed` oneof case. The CycloneDX JSON schema carries
 * `expression` and `expressionDetails` as sibling keys, while the 1.7 proto
 * combines them inside the nested `LicenseExpressionDetailed` message. Only
 * applied for descriptors that actually declare the `expression_detailed`
 * field (1.7), so 1.5/1.6 are unaffected.
 */
function packLicenseChoiceExpressionDetailed(value: JsonRecord): JsonRecord {
  const { expression, expressionDetails, ...rest } = value;
  const expressionDetailed: JsonRecord = {};
  if (expression !== undefined) {
    expressionDetailed.expression = expression;
  }
  if (expressionDetails !== undefined) {
    expressionDetailed.details = expressionDetails;
  }
  return { ...rest, expressionDetailed };
}

/**
 * Inverse of {@link packLicenseChoiceExpressionDetailed}: hoists the protobuf
 * `expressionDetailed` message back into sibling canonical `expression` and
 * `expressionDetails` keys.
 */
function unpackLicenseChoiceExpressionDetailed(result: JsonRecord): JsonRecord {
  const { expressionDetailed, ...rest } = result;
  if (!isJsonRecord(expressionDetailed)) {
    return result;
  }
  const hoisted: JsonRecord = { ...rest };
  if (expressionDetailed.expression !== undefined) {
    hoisted.expression = expressionDetailed.expression;
  }
  const details =
    expressionDetailed.expressionDetails ?? expressionDetailed.details;
  if (details !== undefined) {
    hoisted.expressionDetails = details;
  }
  return hoisted;
}

/**
 * Allocation-free probe for `undefined` anywhere in a subtree. Short-circuits on
 * the first hit, so the common (undefined-free) case is a plain read walk.
 */
function containsUndefined(value: JsonLike): boolean {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry === undefined || containsUndefined(entry)) {
        return true;
      }
    }
    return false;
  }
  if (isJsonRecord(value)) {
    for (const key of Object.keys(value)) {
      const entry = value[key];
      if (entry === undefined || containsUndefined(entry)) {
        return true;
      }
    }
    return false;
  }
  return false;
}

/** Deep copy of `value` with undefined properties and array entries removed. */
function stripUndefined(value: JsonLike): JsonLike {
  if (Array.isArray(value)) {
    const stripped: JsonLike[] = [];
    for (const entry of value) {
      if (entry !== undefined) {
        stripped.push(stripUndefined(entry));
      }
    }
    return stripped;
  }
  if (isJsonRecord(value)) {
    const stripped: JsonRecord = {};
    for (const key of Object.keys(value)) {
      const entry = value[key];
      if (entry !== undefined) {
        stripped[key] = stripUndefined(entry);
      }
    }
    return stripped;
  }
  return value;
}

/**
 * Pass-through for subtrees whose descriptors need no field rewriting. The
 * rewriting can be skipped, but `undefined` still has to go: protobuf-es rejects
 * `undefined` on a known field, and the helper API promises callers may hand it
 * ordinary JavaScript objects without pre-stripping. Probing first keeps the
 * skip allocation-free whenever there is nothing to strip, which is the norm.
 *
 * Only `toProto` can carry `undefined` — the `fromProto` input comes from
 * `toJson`, which never emits it — so that direction returns immediately.
 */
function passThroughUntransformed(
  value: JsonLike,
  direction: NormalizationDirection,
): JsonLike {
  if (direction === "fromProto") {
    return value;
  }
  return containsUndefined(value) ? stripUndefined(value) : value;
}

function transformMessageValue(
  messageDescriptor: MessageDescriptorLike,
  value: JsonLike,
  direction: NormalizationDirection,
): JsonLike {
  if (!isJsonRecord(value)) {
    return value;
  }

  const meta = getMessageMeta(messageDescriptor);
  const isLicenseChoice = messageDescriptor.name === "LicenseChoice";

  if (direction === "toProto") {
    const source =
      isLicenseChoice &&
      meta.hasExpressionDetailedField &&
      Object.hasOwn(value, "expressionDetails")
        ? packLicenseChoiceExpressionDetailed(value)
        : value;
    const normalizedValue: JsonRecord = {};
    for (const key of Object.keys(source)) {
      const rawValue = source[key];
      // Fused sanitization: skip undefined properties in place of a separate
      // deep-clone pass (see sanitizeBomJsonValue).
      if (rawValue === undefined) {
        continue;
      }
      const fieldMeta = meta.byInputKey.get(key);
      if (!fieldMeta) {
        normalizedValue[key] = rawValue;
        continue;
      }
      let sourceValue = rawValue;
      if (
        fieldMeta.isBomObjectWrappedList &&
        !Array.isArray(sourceValue) &&
        isJsonRecord(sourceValue)
      ) {
        sourceValue = [sourceValue];
      }
      normalizedValue[fieldMeta.jsonName] = transformFieldValue(
        fieldMeta.descriptor,
        sourceValue,
        direction,
      );
    }
    return normalizedValue;
  }

  const normalizedValue: JsonRecord = {};
  for (const key of Object.keys(value)) {
    const fieldMeta = meta.byInputKey.get(key);
    if (!fieldMeta) {
      continue;
    }
    let transformedValue = transformFieldValue(
      fieldMeta.descriptor,
      value[key],
      direction,
    );
    if (fieldMeta.isBomObjectWrappedList && Array.isArray(transformedValue)) {
      transformedValue = mergeBomObjectListEntries(transformedValue);
    }
    normalizedValue[fieldMeta.outputKey] = transformedValue;
  }
  if (
    isLicenseChoice &&
    meta.hasExpressionDetailedField &&
    Object.hasOwn(normalizedValue, "expressionDetailed")
  ) {
    return unpackLicenseChoiceExpressionDetailed(normalizedValue);
  }
  return normalizedValue;
}

function normalizeBomJsonForProto(
  schema: AnyBomSchema,
  bomJson: JsonLike,
): JsonLike {
  if (!isJsonRecord(bomJson)) {
    return bomJson;
  }

  // The transform walk fuses undefined-stripping (see transformMessageValue's
  // toProto loop and transformFieldValue's list branch), so a separate
  // sanitizeBomJsonValue deep-clone pass is no longer needed here.
  const protoCompatibleJson = transformMessageValue(schema, bomJson, "toProto");
  if (isJsonRecord(protoCompatibleJson)) {
    delete protoCompatibleJson.bomFormat;
    delete protoCompatibleJson.bom_format;
  }
  return protoCompatibleJson;
}

function normalizeBomJsonFromProto(
  schema: AnyBomSchema,
  bomJson: JsonLike,
  bom?: AnyBom,
): JsonLike {
  if (!isJsonRecord(bomJson)) {
    return bomJson;
  }

  // The transform output is built fresh (only known fields), so it carries no
  // undefined values; a sanitize pass is unnecessary here.
  const normalized = transformMessageValue(
    schema,
    {
      ...bomJson,
      specVersion:
        typeof bomJson.specVersion === "string"
          ? bomJson.specVersion
          : typeof bomJson.spec_version === "string"
            ? bomJson.spec_version
            : bom?.specVersion,
    },
    "fromProto",
  ) as JsonRecord;
  return { bomFormat: "CycloneDX", ...normalized };
}

export function getBomSchema(specVersion: "1.5"): typeof BomSchema15;
export function getBomSchema(specVersion: "1.6"): typeof BomSchema16;
export function getBomSchema(specVersion: "1.7"): typeof BomSchema17;
export function getBomSchema(specVersion: string | number): AnyBomSchema;
export function getBomSchema(specVersion: string | number): AnyBomSchema {
  return bomSchemas[normalizeSpecVersion(specVersion)];
}

export function detectBomSpecVersion(
  value: BomVersionCarrier,
): SupportedSpecVersion {
  return readSpecVersion(value);
}

export function getBomSchemaForBom(bom: AnyBom): AnyBomSchema {
  return getBomSchema(detectBomSpecVersion(bom));
}

export function createBom(
  specVersion: "1.5",
  init?: BomInitByVersion["1.5"],
): BomByVersion["1.5"];
export function createBom(
  specVersion: "1.6",
  init?: BomInitByVersion["1.6"],
): BomByVersion["1.6"];
export function createBom(
  specVersion: "1.7",
  init?: BomInitByVersion["1.7"],
): BomByVersion["1.7"];
export function createBom(
  specVersion: string | number,
  init?: BomInitByVersion[SupportedSpecVersion],
): AnyBom;
export function createBom(
  specVersion: string | number,
  init?: BomInitByVersion[SupportedSpecVersion],
): AnyBom {
  const normalized = normalizeSpecVersion(specVersion);
  return create(getBomSchema(normalized), {
    ...init,
    specVersion: normalized,
  });
}

export function decodeBomBinary(
  specVersion: "1.5",
  bytes: Uint8Array,
  options?: Partial<BinaryReadOptions>,
): BomByVersion["1.5"];
export function decodeBomBinary(
  specVersion: "1.6",
  bytes: Uint8Array,
  options?: Partial<BinaryReadOptions>,
): BomByVersion["1.6"];
export function decodeBomBinary(
  specVersion: "1.7",
  bytes: Uint8Array,
  options?: Partial<BinaryReadOptions>,
): BomByVersion["1.7"];
export function decodeBomBinary(
  specVersion: string | number,
  bytes: Uint8Array,
  options?: Partial<BinaryReadOptions>,
): AnyBom;
export function decodeBomBinary(
  specVersion: string | number,
  bytes: Uint8Array,
  options?: Partial<BinaryReadOptions>,
): AnyBom {
  const normalized = normalizeSpecVersion(specVersion);
  const bom = fromBinary(getBomSchema(normalized), bytes, options);
  assertMatchingSpecVersion(normalized, bom);
  return bom;
}

export function decodeBomJson(
  specVersion: "1.5",
  json: JsonValue,
  options?: Partial<JsonReadOptions>,
): BomByVersion["1.5"];
export function decodeBomJson(
  specVersion: "1.6",
  json: JsonValue,
  options?: Partial<JsonReadOptions>,
): BomByVersion["1.6"];
export function decodeBomJson(
  specVersion: "1.7",
  json: JsonValue,
  options?: Partial<JsonReadOptions>,
): BomByVersion["1.7"];
export function decodeBomJson(
  specVersion: string | number,
  json: JsonValue,
  options?: Partial<JsonReadOptions>,
): AnyBom;
export function decodeBomJson(
  specVersion: string | number,
  json: JsonValue,
  options?: Partial<JsonReadOptions>,
): AnyBom {
  const normalized = normalizeSpecVersion(specVersion);
  const schema = getBomSchema(normalized);
  const protoCompatibleJson = normalizeBomJsonForProto(schema, json);
  if (isJsonRecord(protoCompatibleJson)) {
    const versionCarrier = protoCompatibleJson as BomVersionCarrier;
    if (
      versionCarrier.specVersion !== undefined ||
      versionCarrier.spec_version !== undefined
    ) {
      assertMatchingSpecVersion(normalized, versionCarrier);
    }
  }

  const bom = fromJson(schema, protoCompatibleJson as JsonValue, options);
  if (!bom.specVersion) {
    bom.specVersion = normalized;
  }
  return bom;
}

export function decodeBomJsonString(
  specVersion: "1.5",
  json: string,
  options?: Partial<JsonReadOptions>,
): BomByVersion["1.5"];
export function decodeBomJsonString(
  specVersion: "1.6",
  json: string,
  options?: Partial<JsonReadOptions>,
): BomByVersion["1.6"];
export function decodeBomJsonString(
  specVersion: "1.7",
  json: string,
  options?: Partial<JsonReadOptions>,
): BomByVersion["1.7"];
export function decodeBomJsonString(
  specVersion: string | number,
  json: string,
  options?: Partial<JsonReadOptions>,
): AnyBom;
export function decodeBomJsonString(
  specVersion: string | number,
  json: string,
  options?: Partial<JsonReadOptions>,
): AnyBom {
  return decodeBomJson(specVersion, JSON.parse(json) as JsonValue, options);
}

export function parseBomJson(
  json: JsonValue,
  options?: Partial<JsonReadOptions>,
): AnyBom {
  if (!isJsonRecord(json)) {
    throw new Error("CycloneDX BOM JSON must be an object.");
  }

  // The transform in decodeBomJson fuses undefined-stripping, so the raw input
  // can be passed directly. detectBomSpecVersion only reads specVersion /
  // spec_version, which are never undefined in a valid version carrier.
  return decodeBomJson(
    detectBomSpecVersion(json as BomVersionCarrier),
    json as JsonValue,
    options,
  );
}

export function parseBomJsonString(
  json: string,
  options?: Partial<JsonReadOptions>,
): AnyBom {
  const parsed = JSON.parse(json) as JsonValue;
  return parseBomJson(parsed, options);
}

/**
 * Type guard for a decoded BOM message produced by this library (any of the
 * three supported spec versions). Checks `$typeName` against the known Bom
 * type names rather than duck-typing shape, so a decoded `Bom` passes while an
 * arbitrary protobuf message, a plain object, or a hand-crafted look-alike
 * does not. Consumers accepting "already decoded?" inputs (cdxgen's
 * `resolveBomMessage`) can branch on this instead of probing
 * `$typeName`/`specVersion` themselves.
 */
export function isBomMessage(value: unknown): value is AnyBom {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const carrier = value as { $typeName?: unknown };
  return (
    typeof carrier.$typeName === "string" &&
    bomMessageTypeNames.has(carrier.$typeName)
  );
}

/**
 * Coerces any commonly-seen BOM input into a decoded message, so callers need
 * one entry point instead of choosing between `parseBomJson`,
 * `decodeBomJson`, and `createBom` themselves:
 *
 * - a decoded BOM message is returned unchanged (see {@link isBomMessage});
 * - a JSON *string* is `JSON.parse`d and re-dispatched;
 * - a canonical JSON object carrying `specVersion`/`spec_version` is parsed
 *   with the matching schema (throws for unsupported versions);
 * - a canonical JSON object *without* a version is decoded with `specVersion`
 *   (defaults to the latest supported version);
 * - anything else (null, primitives, arrays) yields an empty BOM created for
 *   `specVersion`, mirroring how cdxgen treats absent input.
 *
 * `options` are protobuf-es JSON read options passed through to the underlying
 * decode (cdxgen uses `{ ignoreUnknownFields: true }`).
 */
export function toBomMessage(
  value: unknown,
  specVersion?: string | number,
  options?: Partial<JsonReadOptions>,
): AnyBom {
  const fallback = specVersion ?? latestSupportedSpecVersion;

  if (isBomMessage(value)) {
    return value;
  }
  if (typeof value === "string" || value instanceof String) {
    return toBomMessage(JSON.parse(`${value}`), fallback, options);
  }
  if (isJsonRecord(value)) {
    const carrier = value as BomVersionCarrier;
    if (
      carrier.specVersion !== undefined ||
      carrier.spec_version !== undefined
    ) {
      return parseBomJson(value as JsonValue, options);
    }
    return decodeBomJson(fallback, value as JsonValue, options);
  }
  return createBom(fallback);
}

export function encodeBomBinary(
  bom: AnyBom,
  options?: Partial<BinaryWriteOptions>,
): Uint8Array {
  return toBinary(getBomSchemaForBom(bom), bom, options);
}

export function encodeBomJson(
  bom: BomByVersion["1.5"],
  options?: Partial<JsonWriteOptions>,
): BomJsonByVersion["1.5"];
export function encodeBomJson(
  bom: BomByVersion["1.6"],
  options?: Partial<JsonWriteOptions>,
): BomJsonByVersion["1.6"];
export function encodeBomJson(
  bom: BomByVersion["1.7"],
  options?: Partial<JsonWriteOptions>,
): BomJsonByVersion["1.7"];
export function encodeBomJson(
  bom: AnyBom,
  options?: Partial<JsonWriteOptions>,
): AnyBomJson;
export function encodeBomJson(
  bom: AnyBom,
  options?: Partial<JsonWriteOptions>,
): JsonValue {
  const schema = getBomSchemaForBom(bom);
  return normalizeBomJsonFromProto(
    schema,
    toJson(schema, bom, options),
    bom,
  ) as JsonValue;
}

/**
 * Reads the `spec_version` string (field 1, wire type LEN → tag 0x0A) from the
 * start of a protobuf Bom encoding without decoding the whole message. Returns
 * the version string when the first top-level field is a well-formed
 * length-delimited value, or `undefined` to fall back to brute-force decoding.
 */
function peekSpecVersionFromBinary(bytes: Uint8Array): string | undefined {
  if (bytes.length < 2 || bytes[0] !== 0x0a) {
    return undefined;
  }
  let length = 0;
  let shift = 0;
  let pos = 1;
  while (pos < bytes.length) {
    const byte = bytes[pos];
    pos += 1;
    if (byte === undefined) {
      return undefined;
    }
    length |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7;
    if (shift > 35) {
      return undefined;
    }
  }
  if (length <= 0 || pos + length > bytes.length) {
    return undefined;
  }
  let version = "";
  for (let i = pos; i < pos + length; i += 1) {
    version += String.fromCharCode(bytes[i] ?? 0);
  }
  return version;
}

export function parseBomBinary(
  bytes: Uint8Array,
  options?: Partial<BinaryReadOptions>,
): AnyBom {
  const peeked = peekSpecVersionFromBinary(bytes);
  if (peeked !== undefined) {
    try {
      return decodeBomBinary(normalizeSpecVersion(peeked), bytes, options);
    } catch {
      // The peek may have read a non-version string (e.g. field 1 was not
      // spec_version in an odd input). Fall through to brute-force below.
    }
  }

  let lastError: unknown;
  for (const specVersion of SUPPORTED_BINARY_READ_ORDER) {
    try {
      return decodeBomBinary(specVersion, bytes, options);
    } catch (error) {
      lastError = error;
    }
  }

  throw (
    lastError ?? new Error("Unable to decode CycloneDX protobuf BOM binary.")
  );
}

/**
 * Encodes a BOM as a base64 string of its protobuf binary form — the same
 * bytes {@link encodeBomBinary} produces, in a transport that survives JSON
 * documents, OCI labels, in-toto predicates, environment variables, and other
 * contexts that cannot carry raw bytes. Uses protobuf-es' own base64 codec
 * (`@bufbuild/protobuf/wire`) rather than Node's `Buffer`, so the main entry
 * stays usable from browsers and edge runtimes.
 */
export function encodeBomBase64(
  bom: AnyBom,
  options?: Partial<BinaryWriteOptions>,
): string {
  return base64Encode(encodeBomBinary(bom, options));
}

export function decodeBomBase64(
  specVersion: "1.5",
  base64: string,
  options?: Partial<BinaryReadOptions>,
): BomByVersion["1.5"];
export function decodeBomBase64(
  specVersion: "1.6",
  base64: string,
  options?: Partial<BinaryReadOptions>,
): BomByVersion["1.6"];
export function decodeBomBase64(
  specVersion: "1.7",
  base64: string,
  options?: Partial<BinaryReadOptions>,
): BomByVersion["1.7"];
export function decodeBomBase64(
  specVersion: string | number,
  base64: string,
  options?: Partial<BinaryReadOptions>,
): AnyBom;
export function decodeBomBase64(
  specVersion: string | number,
  base64: string,
  options?: Partial<BinaryReadOptions>,
): AnyBom {
  return decodeBomBinary(specVersion, base64Decode(base64), options);
}

/**
 * Decodes a base64 protobuf BOM whose spec version is not known ahead of time,
 * mirroring {@link parseBomBinary}: the embedded `spec_version` field is read
 * first and the matching schema decodes the payload. Throws for inputs that no
 * supported schema can decode.
 */
export function parseBomBase64(
  base64: string,
  options?: Partial<BinaryReadOptions>,
): AnyBom {
  return parseBomBinary(base64Decode(base64), options);
}

export function encodeBomJsonString(
  bom: AnyBom,
  options?: Partial<JsonWriteStringOptions>,
): string {
  return JSON.stringify(
    encodeBomJson(bom, options),
    undefined,
    options?.prettySpaces ?? 0,
  );
}

export type BomConversionResult = {
  bom: AnyBom;
  warnings: string[];
};

/**
 * Canonical JSON paths whose cardinality changes between spec versions. Both
 * were single objects in 1.5 and became arrays in 1.6 (confirmed against the
 * upstream JSON schemas: bom-1.5 `metadata.licenses` refs a single
 * `licenseChoice`, while 1.6 refs the array form). Nothing changes on the
 * 1.6 <-> 1.7 boundary.
 *
 * A canonical JSON produced for one side of that boundary cannot be decoded by
 * the other: protobuf-es rejects an object where the target schema expects a
 * list ("expected Array, got object") and an array where it expects a single
 * message. convertBom therefore reshapes these two paths before decoding —
 * wrapping on upgrade, keeping the first entry on downgrade — so the dropped
 * data surfaces as warnings instead of an exception.
 */
/**
 * `evidence.identity` is reachable from every place a `Component` can appear,
 * and a canonical BOM nests components freely: `components[].components[]`,
 * `metadata.component` (and its own subtree), `metadata.tools.components[]`,
 * `formulation[].components[]`, and their equivalents in later specs. Rather
 * than enumerate those paths — the previous approach, which silently missed
 * every one but top-level `components[]` — the reshape walks the document and
 * fixes any `evidence` record it finds. `evidence` belongs only to `Component`
 * in CycloneDX, and the reshape is shape-driven and idempotent, so a stray
 * match cannot corrupt a correctly-shaped value.
 *
 * `metadata.licenses` is handled separately because `licenses` is *not* a
 * cardinality boundary anywhere else: on a component it is a list in every
 * supported spec version, so a blind walk would wrongly collapse it.
 */
function reshapeComponentEvidence(
  value: JsonLike,
  reshape: (value: JsonLike) => JsonLike,
): JsonLike {
  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((entry) => {
      const next = reshapeComponentEvidence(entry, reshape);
      changed ||= next !== entry;
      return next;
    });
    return changed ? mapped : value;
  }
  if (!isJsonRecord(value)) {
    return value;
  }

  let result = value;
  const assign = (key: string, next: JsonLike): void => {
    if (result === value) {
      result = { ...value };
    }
    result[key] = next;
  };

  for (const [key, child] of Object.entries(value)) {
    if (
      key === "evidence" &&
      isJsonRecord(child) &&
      child.identity !== undefined
    ) {
      const identity = reshape(child.identity);
      if (identity !== child.identity) {
        const next = { ...child, identity };
        // An empty list collapses to nothing: drop the key rather than hand
        // the decoder an explicit `undefined`.
        if (identity === undefined) {
          delete next.identity;
        }
        assign(key, next);
      }
      continue;
    }
    const next = reshapeComponentEvidence(child, reshape);
    if (next !== child) {
      assign(key, next);
    }
  }
  return result;
}

/**
 * Copy-on-write reshape of the singular/list boundary fields for a decode into
 * `target`. Values are inspected by shape, not by source version, so the
 * reshape is idempotent and also repairs inputs produced by older tooling:
 * an object becomes `[object]` when the target expects a list (1.6+), and an
 * array collapses to its first entry when the target expects a single object
 * (1.5; an empty array drops the key). Untouched subtrees are shared, never
 * deep-copied, and `source` itself is never mutated — the caller still diffs
 * against it to compute warnings.
 */
function reshapeCardinalityBoundaries(
  source: JsonRecord,
  target: SupportedSpecVersion,
): JsonRecord {
  const singularInTarget = target === "1.5";

  const reshape = (value: JsonLike): JsonLike => {
    if (singularInTarget) {
      return Array.isArray(value) ? value[0] : value;
    }
    return isJsonRecord(value) ? [value] : value;
  };

  const walked = reshapeComponentEvidence(source, reshape) as JsonRecord;
  const result: JsonRecord = walked === source ? { ...source } : walked;

  const metadata = result.metadata;
  if (isJsonRecord(metadata) && metadata.licenses !== undefined) {
    const licenses = reshape(metadata.licenses);
    if (licenses !== metadata.licenses) {
      const next = { ...metadata, licenses };
      if (licenses === undefined) {
        delete next.licenses;
      }
      result.metadata = next;
    }
  }
  return result;
}

/**
 * Converts a BOM to a different CycloneDX spec version (1.5 <-> 1.6 <->
 * 1.7, up or down). Works by round-tripping through canonical JSON: the source
 * is encoded, the `specVersion` is rewritten, and the target schema decodes it
 * with `ignoreUnknownFields` so fields the target does not know are silently
 * dropped rather than throwing. Fields that change cardinality between
 * versions (`metadata.licenses`, and `evidence.identity` on a component
 * anywhere in the document — singular in 1.5, a list since 1.6) are reshaped
 * first: wrapped on upgrade, collapsed to their first entry on downgrade. The
 * `evidence.identity` reshape is recursive, so nested `components[]`,
 * `metadata.component`, `metadata.tools.components[]` and
 * `formulation[].components[]` are covered. A recursive key diff produces
 * human-readable `warnings` listing the field paths that were lost — including
 * collapsed list siblings — so downgrades are lossy-but-visible rather than
 * silent. Upgrades typically produce no warnings because every lower-version
 * field exists in the higher schema.
 */
export function convertBom(
  bom: AnyBom,
  targetSpecVersion: string | number,
): BomConversionResult {
  const target = normalizeSpecVersion(targetSpecVersion);
  const sourceJson = encodeBomJson(bom) as JsonRecord;
  // Reshape the singular<->list boundary fields (metadata.licenses,
  // components[].evidence.identity) so the target schema can decode the
  // candidate at all; the original sourceJson stays untouched for the diff.
  const candidate = reshapeCardinalityBoundaries(sourceJson, target);
  candidate.specVersion = target;
  delete candidate.spec_version;

  const converted = decodeBomJson(target, candidate as JsonValue, {
    ignoreUnknownFields: true,
  });

  const resultJson = encodeBomJson(converted) as JsonRecord;
  const dropped = new Set<string>();
  collectDroppedPaths(sourceJson, resultJson, "$", dropped);

  return { bom: converted, warnings: Array.from(dropped).sort() };
}

/**
 * Records every path present in `source` but absent from `target`, which for a
 * downgrade is exactly the set of fields the target spec version cannot express.
 *
 * Arrays are walked element-wise but reported with a collapsed `[]` segment, and
 * paths are accumulated in a Set. A 10,000-component BOM that loses
 * `component.tags` therefore yields the single warning `$.components[].tags`
 * rather than 10,000 indexed duplicates. Element order is preserved by the
 * encode/decode round-trip, so comparing by index is sound; the length guard is
 * defensive only.
 */
function collectDroppedPaths(
  source: JsonLike,
  target: JsonLike,
  path: string,
  dropped: Set<string>,
): void {
  if (Array.isArray(source)) {
    if (Array.isArray(target)) {
      const shared = Math.min(source.length, target.length);
      for (let index = 0; index < shared; index += 1) {
        collectDroppedPaths(source[index], target[index], `${path}[]`, dropped);
      }
      return;
    }
    if (isJsonRecord(target)) {
      // The target schema carries a single entry where the source had a list
      // (the 1.5 singular side of a cardinality boundary, e.g.
      // `evidence.identity`): only index 0 can survive, so the diff continues
      // against that entry and every sibling is reported as dropped.
      const [first] = source;
      if (first !== undefined) {
        collectDroppedPaths(first, target, `${path}[]`, dropped);
      }
      for (let index = 1; index < source.length; index += 1) {
        dropped.add(`${path}[${index}]`);
      }
    }
    return;
  }
  if (!isJsonRecord(source) || !isJsonRecord(target)) {
    // The mirror image of the collapse above: the source carried a single
    // entry and the target wraps it in a list (upgrade across a cardinality
    // boundary). Diff against the surviving first element instead of flagging
    // every source key as dropped.
    if (isJsonRecord(source) && Array.isArray(target)) {
      const [first] = target;
      if (isJsonRecord(first)) {
        collectDroppedPaths(source, first, path, dropped);
      }
    }
    return;
  }
  for (const key of Object.keys(source)) {
    if (key === "specVersion") {
      continue;
    }
    const childPath = `${path}.${key}`;
    if (!Object.hasOwn(target, key)) {
      dropped.add(childPath);
      continue;
    }
    collectDroppedPaths(source[key], target[key], childPath, dropped);
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export type BomStats = {
  specVersion: SupportedSpecVersion;
  componentCount: number;
  dependencyCount: number;
  jsonByteSize: number;
  binaryByteSize: number;
  compressionRatio: number;
};

/**
 * Computes cheap summary statistics for a BOM: component and dependency counts,
 * canonical JSON and protobuf binary byte sizes, and the JSON-to-binary
 * compression ratio. Shared by the CLI's `inspect` command.
 */
export function bomStats(bom: AnyBom): BomStats {
  const jsonString = encodeBomJsonString(bom);
  const jsonBytes = utf8ByteLength(jsonString);
  const binaryBytes = encodeBomBinary(bom).byteLength;
  return {
    specVersion: detectBomSpecVersion(bom),
    componentCount: bom.components.length,
    dependencyCount: bom.dependencies.length,
    jsonByteSize: jsonBytes,
    binaryByteSize: binaryBytes,
    compressionRatio:
      jsonBytes > 0 ? binaryBytes / jsonBytes : 0,
  };
}
