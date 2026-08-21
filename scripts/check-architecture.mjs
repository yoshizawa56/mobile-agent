import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const workspaceRoots = ["apps", "packages"];
const workspacePackages = new Map();
const errors = [];

for (const workspaceRoot of workspaceRoots) {
  for (const entry of readdirSync(join(root, workspaceRoot))) {
    const directory = join(root, workspaceRoot, entry);
    if (!statSync(directory).isDirectory()) continue;
    const packageFile = join(directory, "package.json");
    try {
      const packageJson = JSON.parse(readFileSync(packageFile, "utf8"));
      workspacePackages.set(packageJson.name, {
        directory,
        relativeDirectory: relative(root, directory).split(sep).join("/"),
        dependencies: new Set(Object.keys(packageJson.dependencies ?? {})),
      });
    } catch {
      // Directories without a package.json are not workspace packages.
    }
  }
}

const packageRules = new Map([
  ["@muximo/api", []],
  ["@muximo/application", ["@muximo/domain"]],
  ["@muximo/domain", []],
  ["@muximo/infrastructure", ["@muximo/api", "@muximo/application", "@muximo/domain"]],
  ["@muximo/test-support", []],
  ["@muximo/muximo-cli", ["@muximo/infrastructure"]],
  ["@muximo/muximod", ["@muximo/infrastructure"]],
  ["@muximo/web", ["@muximo/api"]],
]);

const forbiddenImports = [
  {
    root: "packages/api/src",
    packages: /^@muximo\//,
    runtimes: /^(?:node|bun):/,
  },
  {
    root: "packages/domain/src",
    packages: /^@muximo\//,
    runtimes: /^(?:node|bun):/,
  },
  {
    root: "packages/application/src",
    packages: /^@muximo\/(?:api|infrastructure)/,
    runtimes: /^(?:node|bun):/,
  },
];

for (const [packageName, packageInfo] of workspacePackages) {
  const allowed = packageRules.get(packageName);
  if (!allowed) continue;
  for (const dependency of packageInfo.dependencies) {
    if (dependency.startsWith("@muximo/") && !allowed.includes(dependency)) {
      errors.push(`${packageName}: package.json dependency ${dependency} points outside its allowed layer`);
    }
  }
}

for (const sourceRoot of workspaceRoots) {
  scanDirectory(join(root, sourceRoot));
}

if (errors.length > 0) {
  for (const error of errors) console.error(`architecture: ${error}`);
  process.exitCode = 1;
} else {
  console.log("architecture: dependency direction is valid");
}

function scanDirectory(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const relativePath = relative(root, path).split(sep).join("/");
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    if (statSync(path).isDirectory()) {
      scanDirectory(path);
      continue;
    }
    if (!/\.(?:ts|tsx|mts|cts|mjs)$/.test(entry) || isTestArtifact(relativePath)) continue;
    inspectSource(path, relativePath);
  }
}

function inspectSource(path, relativePath) {
  const source = readFileSync(path, "utf8");
  const sourcePackage = packageForPath(relativePath);
  const importPattern = /\b(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
  let match;
  while ((match = importPattern.exec(source)) !== null) {
    const specifier = match[1];
    const line = source.slice(0, match.index).split("\n").length;
    const rule = forbiddenImports.find((candidate) => relativePath.startsWith(candidate.root));
    if (rule && (rule.packages.test(specifier) || rule.runtimes.test(specifier))) {
      errors.push(`${relativePath}:${line}: forbidden ${specifier} import for this layer`);
    }

    const dependency = workspacePackageName(specifier);
    if (sourcePackage && dependency && dependency !== sourcePackage) {
      const packageInfo = workspacePackages.get(sourcePackage);
      if (packageInfo && !packageInfo.dependencies.has(dependency)) {
        errors.push(`${relativePath}:${line}: ${dependency} is imported but is not a production dependency of ${sourcePackage}`);
      }
    }
  }
}

function packageForPath(relativePath) {
  for (const [packageName, packageInfo] of workspacePackages) {
    if (relativePath.startsWith(`${packageInfo.relativeDirectory}/`)) return packageName;
  }
  return undefined;
}

function workspacePackageName(specifier) {
  if (!specifier.startsWith("@muximo/")) return undefined;
  const match = specifier.match(/^(@muximo\/[^/]+)/);
  return match?.[1];
}

function isTestArtifact(relativePath) {
  return /(?:^|\/)(?:__tests__|fixtures)(?:\/|$)|(?:\.test|\.spec|\.stories)\.[^.]+$/.test(relativePath);
}
