# cdx-proto performance baseline

Recorded on the `improvement-plan` branch after Phases 0–4 and the Phase 2
fast-path work (2a–2d). Use as a reference for detecting regressions: re-run
`npm run bench` after a change and compare the median column.

## Methodology

- `bench/fixtures.mjs` generates a deterministic 1.7 BOM (no `Math.random`).
- Each component carries a `bom-ref`, one SHA-256 hash, one SPDX license, and
  two properties. One dependency edge per component.
- `bench/roundtrip.mjs` measures each operation 6 times with
  `node:perf_hooks`, discards the first run as warm-up, and reports the median
  of the remaining 5.

## Current (Apple Silicon, Node v24.18.0, spec 1.7)

| components | json bytes | binary bytes | parseBomJson (ms) | encodeBomJson (ms) | encodeBomJsonString (ms) | encodeBomBinary (ms) | parseBomBinary (ms) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 40809 | 22911 | 1.02 | 0.42 | 0.46 | 0.77 | 0.51 |
| 1000 | 416859 | 238761 | 4.60 | 2.80 | 4.28 | 5.97 | 4.15 |
| 10000 | 4267359 | 2487261 | 47.3 | 28.6 | 40.4 | 66.0 | 45.2 |

## Before Phase 2 (same machine, same workload)

| components | parseBomJson (ms) | encodeBomJson (ms) |
| ---: | ---: | ---: |
| 10000 | 233.3 | 69.9 |

**Phase 2 brought parseBomJson from 233 ms → 47 ms (4.9x) and encodeBomJson
from 70 ms → 29 ms (2.4x) at 10 000 components.** The normalization layer now
sits at ~1.6x the raw protobuf-es `fromJson` cost (30 ms) for parse and ~2.2x
the raw `toJson` cost (13 ms) for encode, down from 4–5x.

The protobuf binary is ~42 % smaller than the equivalent canonical JSON for
this workload.
