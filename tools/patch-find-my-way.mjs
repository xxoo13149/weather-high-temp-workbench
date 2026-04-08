import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createRequire } from "node:module";

const baseUrl = `file://${process.cwd()}/`;
const requireModule = createRequire(baseUrl);
const fastifyPath = requireModule.resolve("fastify/fastify");
const fastifyDir = dirname(fastifyPath);
const findMyWayPath = requireModule.resolve("find-my-way/lib/node.js", { paths: [fastifyDir] });

const original = await readFile(findMyWayPath, "utf8");
if (!original.includes("new Function")) {
  console.log("[patch-find-my-way] already patched");
  process.exit(0);
}

const matcher = /  _compilePrefixMatch \(\) {\n[\s\S]*?\n}\n\n(?=class ParametricNode)/;
const replacement = `  _compilePrefixMatch () {
    if (this.prefix.length === 1) {
      this.matchPrefix = () => true;
      return;
    }

    const prefix = this.prefix;
    const length = prefix.length;
    this.matchPrefix = (path, index) => {
      if (path.length - index < length) {
        return false;
      }

      for (let offset = 1; offset < length; offset++) {
        if (path.charCodeAt(index + offset) !== prefix.charCodeAt(offset)) {
          return false;
        }
      }

      return true;
    };
  }

`;

if (!matcher.test(original)) {
  throw new Error("Unable to locate _compilePrefixMatch block for patching");
}

const patched = original.replace(matcher, replacement);
await writeFile(findMyWayPath, patched, "utf8");
console.log("[patch-find-my-way] applied patch to find-my-way");
