import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const roots = ["src", "tests", "tools", "zip"];
const extraFiles = ["README.md", "package.json", ".editorconfig"];
const frontendSourceTargets = ["zip/src", "zip/index.html", "zip/package.json", "zip/vite.config.ts"];
const frontendBuildEntry = join(process.cwd(), "zip", "dist", "index.html");
const textFilePattern = /\.(html|css|js|ts|tsx|md|json)$/i;
const suspiciousTokens = ["\u9225", "\u63b3", "Â°", "â€", "Ã"];
const ignoredDirectories = new Set(["node_modules", "dist", ".git", ".npm-cache"]);
const failures = [];

const shouldIgnoreDirectory = (name) =>
  ignoredDirectories.has(name) || name.startsWith("tmp-snapshot-");

const normalizePath = (target) => target.replace(/\\/g, "/");
const isApplicationSourceFile = (target) => {
  const normalized = normalizePath(target);
  return normalized.startsWith("src/") || normalized.startsWith("zip/src/");
};

const isFrontendSourceFile = (target) => normalizePath(target).startsWith("zip/src/");

const visit = (target) => {
  const stats = statSync(target);
  if (stats.isDirectory()) {
    if (shouldIgnoreDirectory(basename(target))) {
      return;
    }

    for (const name of readdirSync(target)) {
      visit(join(target, name));
    }
    return;
  }

  if (!textFilePattern.test(target)) {
    return;
  }

  const bytes = readFileSync(target);
  let text;

  try {
    text = utf8.decode(bytes);
  } catch (error) {
    failures.push(`${target}: not valid UTF-8 (${String(error)})`);
    return;
  }

  if (text.includes("\uFFFD")) {
    failures.push(`${target}: contains replacement character U+FFFD`);
  }

  if (isApplicationSourceFile(target)) {
    for (const token of suspiciousTokens) {
      if (text.includes(token)) {
        failures.push(`${target}: contains suspicious mojibake token ${JSON.stringify(token)}`);
      }
    }
  }

  if (isFrontendSourceFile(target) && /\\u[0-9a-fA-F]{4}/.test(text)) {
    failures.push(`${target}: contains raw unicode escape placeholders in frontend source`);
  }
};

const getLatestModifiedTime = (target) => {
  if (!existsSync(target)) {
    return 0;
  }

  const stats = statSync(target);
  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }

  if (shouldIgnoreDirectory(basename(target))) {
    return 0;
  }

  let latest = stats.mtimeMs;
  for (const name of readdirSync(target)) {
    latest = Math.max(latest, getLatestModifiedTime(join(target, name)));
  }

  return latest;
};

for (const root of roots) {
  visit(root);
}
for (const file of extraFiles) {
  visit(file);
}

if (existsSync(frontendBuildEntry)) {
  const buildModifiedTime = statSync(frontendBuildEntry).mtimeMs;
  const sourceModifiedTime = Math.max(...frontendSourceTargets.map((target) => getLatestModifiedTime(target)));

  if (sourceModifiedTime > buildModifiedTime) {
    failures.push(`${frontendBuildEntry}: frontend build is older than source files; run "npm --prefix zip run build".`);
  }
}

if (failures.length > 0) {
  console.error(`Encoding check failed:\n${failures.map((line) => `- ${line}`).join("\n")}`);
  process.exit(1);
}

console.log("Encoding check passed.");
