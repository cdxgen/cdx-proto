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

const enumMapCache = new Map<string, EnumMapPair>();

const BOM_OBJECT_WRAPPED_LIST_FIELDS = new Set(["declarations", "definitions"]);

function isJsonRecord(value: JsonLike): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeBomJsonValue(value: JsonLike): JsonLike {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== undefined)
      .map((entry) => sanitizeBomJsonValue(entry));
  }

  if (isJsonRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, sanitizeBomJsonValue(entry)]),
    );
  }

  return value;
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

function normalizeSpecVersion(
  specVersion: string | number,
): SupportedSpecVersion {
  const normalized = String(specVersion).trim().toLowerCase().replace(/^v/, "");
  const match = /^(1\.[567])(?:\.0+)?$/.exec(normalized);
  if (match) {
    return match[1] as SupportedSpecVersion;
  }

  throw new Error(
    `Unsupported CycloneDX spec version: ${String(specVersion)}. Supported versions: ${supportedSpecVersions.join(", ")}`,
  );
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
  const cachedMaps = enumMapCache.get(enumDescriptor.typeName);
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
  enumMapCache.set(enumDescriptor.typeName, enumMaps);
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

function getFieldInputKeys(
  messageDescriptor: MessageDescriptorLike,
  fieldDescriptor: FieldDescriptorLike,
): string[] {
  return Array.from(
    new Set(
      [
        getFieldAlias(messageDescriptor, fieldDescriptor),
        fieldDescriptor.jsonName,
        fieldDescriptor.localName,
        fieldDescriptor.name,
        `${fieldDescriptor.name}`.replaceAll("_", "-"),
      ].filter((entry): entry is string => Boolean(entry)),
    ),
  );
}

function getFieldOutputKey(
  messageDescriptor: MessageDescriptorLike,
  fieldDescriptor: FieldDescriptorLike,
): string {
  return (
    getFieldAlias(messageDescriptor, fieldDescriptor) ??
    fieldDescriptor.jsonName
  );
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
      if (fieldDescriptor.listKind === "enum" && fieldDescriptor.enum) {
        const enumDescriptor = fieldDescriptor.enum;
        return value.map((entry) =>
          transformEnumValue(enumDescriptor, entry, direction),
        );
      }
      if (fieldDescriptor.listKind === "message" && fieldDescriptor.message) {
        const messageDescriptor = fieldDescriptor.message;
        return value.map((entry) =>
          transformMessageValue(messageDescriptor, entry, direction),
        );
      }
      return value;
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
      return transformMessageValue(fieldDescriptor.message, value, direction);
    default:
      return value;
  }
}

function transformMessageValue(
  messageDescriptor: MessageDescriptorLike,
  value: JsonLike,
  direction: NormalizationDirection,
): JsonLike {
  if (!isJsonRecord(value)) {
    return value;
  }

  if (direction === "toProto") {
    const normalizedValue: JsonRecord = { ...value };
    for (const fieldDescriptor of messageDescriptor.fields) {
      const sourceKey = getFieldInputKeys(
        messageDescriptor,
        fieldDescriptor,
      ).find((key) => Object.hasOwn(value, key));
      if (!sourceKey) {
        continue;
      }
      const sourceValue = shouldWrapBomObjectListField(
        messageDescriptor,
        fieldDescriptor,
      )
        ? Array.isArray(value[sourceKey]) || !isJsonRecord(value[sourceKey])
          ? value[sourceKey]
          : [value[sourceKey]]
        : value[sourceKey];
      const transformedValue = transformFieldValue(
        fieldDescriptor,
        sourceValue,
        direction,
      );
      for (const inputKey of getFieldInputKeys(
        messageDescriptor,
        fieldDescriptor,
      )) {
        if (inputKey !== fieldDescriptor.jsonName) {
          delete normalizedValue[inputKey];
        }
      }
      normalizedValue[fieldDescriptor.jsonName] = transformedValue;
    }
    return normalizedValue;
  }

  const normalizedValue: JsonRecord = {};
  for (const fieldDescriptor of messageDescriptor.fields) {
    const sourceKey = [
      fieldDescriptor.jsonName,
      fieldDescriptor.localName,
      fieldDescriptor.name,
    ].find((key) => Object.hasOwn(value, key));
    if (!sourceKey) {
      continue;
    }

    let transformedValue = transformFieldValue(
      fieldDescriptor,
      value[sourceKey],
      direction,
    );
    if (shouldWrapBomObjectListField(messageDescriptor, fieldDescriptor)) {
      transformedValue = Array.isArray(transformedValue)
        ? mergeBomObjectListEntries(transformedValue)
        : transformedValue;
    }

    normalizedValue[getFieldOutputKey(messageDescriptor, fieldDescriptor)] =
      transformedValue;
  }
  return normalizedValue;
}

function normalizeBomJsonForProto(
  schema: AnyBomSchema,
  bomJson: JsonLike,
): JsonLike {
  const normalizedBomJson = sanitizeBomJsonValue(bomJson);
  if (!isJsonRecord(normalizedBomJson)) {
    return normalizedBomJson;
  }

  const protoCompatibleJson = transformMessageValue(
    schema,
    normalizedBomJson,
    "toProto",
  );
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

  return sanitizeBomJsonValue({
    bomFormat: "CycloneDX",
    ...((transformMessageValue(
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
    ) as JsonRecord) || {}),
  });
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
  const sanitizedBomJson = sanitizeBomJsonValue(json);
  if (!isJsonRecord(sanitizedBomJson)) {
    throw new Error("CycloneDX BOM JSON must be an object.");
  }

  return decodeBomJson(
    detectBomSpecVersion(sanitizedBomJson as BomVersionCarrier),
    sanitizedBomJson as JsonValue,
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
  return normalizeBomJsonFromProto(
    getBomSchemaForBom(bom),
    toJson(getBomSchemaForBom(bom), bom, options),
    bom,
  ) as JsonValue;
}

export function parseBomBinary(
  bytes: Uint8Array,
  options?: Partial<BinaryReadOptions>,
): AnyBom {
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
