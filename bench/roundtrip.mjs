// Benchmark runner for cdx-proto encode/decode operations.
//
// Times parseBomJson, encodeBomJson, encodeBomBinary, parseBomBinary, and
// encodeBomJsonString at 100 / 1000 / 10000 components. Uses node:perf_hooks,
// runs at least 5 iterations, discards the first as warm-up, and reports the
// median. Prints a markdown table with milliseconds and byte sizes.
//
// Usage: npm run bench
import { performance } from "node:perf_hooks";

import {
  encodeBomBinary,
  encodeBomJson,
  encodeBomJsonString,
  parseBomBinary,
  parseBomJson,
} from "../dist/index.js";
import { makeSyntheticBom } from "./fixtures.mjs";

const SIZES = [100, 1000, 10000];
const ITERATIONS = 6; // first is discarded as warm-up → 5 measured
const SPEC_VERSION = "1.7";

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function timeOperation(fn) {
  const samples = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = performance.now();
    fn();
    const end = performance.now();
    if (i > 0) {
      samples.push(end - start);
    }
  }
  return median(samples);
}

function formatMs(ms) {
  return ms < 10 ? ms.toFixed(2) : ms.toFixed(1);
}

const rows = [];

for (const size of SIZES) {
  const bomJson = makeSyntheticBom({
    specVersion: SPEC_VERSION,
    components: size,
    deps: size,
  });

  const jsonBytes = Buffer.byteLength(JSON.stringify(bomJson));

  const parseMs = timeOperation(() => parseBomJson(bomJson));

  const bom = parseBomJson(bomJson);
  const encodeJsonMs = timeOperation(() => encodeBomJson(bom));
  const encodeJsonStringMs = timeOperation(() => encodeBomJsonString(bom));

  const binary = encodeBomBinary(bom);
  const binaryBytes = binary.byteLength;

  const encodeBinaryMs = timeOperation(() => encodeBomBinary(bom));
  const parseBinaryMs = timeOperation(() => parseBomBinary(binary));

  rows.push({
    size,
    jsonBytes,
    binaryBytes,
    parseMs,
    encodeJsonMs,
    encodeJsonStringMs,
    encodeBinaryMs,
    parseBinaryMs,
  });
}

// Print markdown table.
const header = [
  "components",
  "json bytes",
  "binary bytes",
  "parseBomJson (ms)",
  "encodeBomJson (ms)",
  "encodeBomJsonString (ms)",
  "encodeBomBinary (ms)",
  "parseBomBinary (ms)",
];
const separator = header.map(() => "---:");

console.log(`| ${header.join(" | ")} |`);
console.log(`| ${separator.join(" | ")} |`);

for (const row of rows) {
  const cells = [
    row.size,
    row.jsonBytes,
    row.binaryBytes,
    formatMs(row.parseMs),
    formatMs(row.encodeJsonMs),
    formatMs(row.encodeJsonStringMs),
    formatMs(row.encodeBinaryMs),
    formatMs(row.parseBinaryMs),
  ];
  console.log(`| ${cells.join(" | ")} |`);
}

console.log(
  `\n_Node ${process.version}; spec ${SPEC_VERSION}; median of ${ITERATIONS - 1} runs (1 warm-up discarded)_`,
);
