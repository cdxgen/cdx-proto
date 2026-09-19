import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const artifactDirectory = new URL("../.artifacts", import.meta.url);
const artifactPath = fileURLToPath(artifactDirectory);
const workspacePath = fileURLToPath(new URL("..", import.meta.url));

rmSync(artifactPath, { force: true, recursive: true });
mkdirSync(artifactPath, { recursive: true });

const stdout = execFileSync(
  "npm",
  ["pack", "--ignore-scripts", "--json", "--pack-destination", artifactPath],
  {
    cwd: workspacePath,
    encoding: "utf8",
  },
);

const [packResult] = JSON.parse(stdout);

if (!packResult) {
  throw new Error("npm pack did not return any package metadata.");
}

const filePaths = new Set(packResult.files.map((file) => file.path));
const requiredPaths = [
  "dist/index.d.ts",
  "dist/index.js",
  "dist/helpers.d.ts",
  "dist/helpers.js",
  "dist/v1.5.d.ts",
  "dist/v1.5.js",
  "dist/v1.6.d.ts",
  "dist/v1.6.js",
  "dist/v1.7.d.ts",
  "dist/v1.7.js",
  "dist/node.d.ts",
  "dist/node.js",
  "specification/bom-1.5.proto",
  "specification/bom-1.6.proto",
  "specification/bom-1.7.proto",
];

for (const requiredPath of requiredPaths) {
  if (!filePaths.has(requiredPath)) {
    throw new Error(`Expected packed artifact to include '${requiredPath}'.`);
  }
}

for (const filePath of filePaths) {
  if (filePath === "docs" || filePath.startsWith("docs/")) {
    throw new Error(
      `Packed artifact must not include documentation files: '${filePath}'.`,
    );
  }
  if (filePath === "bench" || filePath.startsWith("bench/")) {
    throw new Error(
      `Packed artifact must not include benchmark files: '${filePath}'.`,
    );
  }
  if (filePath === "tests" || filePath.startsWith("tests/")) {
    throw new Error(
      `Packed artifact must not include test files: '${filePath}'.`,
    );
  }
}

if (packResult.size <= 0 || packResult.unpackedSize <= 0) {
  throw new Error("Packed artifact reported an invalid size.");
}

console.log(
  `Verified npm package ${packResult.name}@${packResult.version} (${packResult.filename}) with ${packResult.entryCount} files.`,
);
console.log(
  `Packed size: ${packResult.size} bytes, unpacked size: ${packResult.unpackedSize} bytes.`,
);
