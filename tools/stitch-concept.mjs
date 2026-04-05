import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_VARIANT_COUNT = 4;
const DEFAULT_CREATIVE_RANGE = "EXPLORE";
const VALID_VARIANT_COUNT = new Set([3, 4, 5]);
const VALID_CREATIVE_RANGES = new Set(["REFINE", "EXPLORE", "REIMAGINE"]);
const DEFAULT_OUTPUT_DIR = path.resolve("docs", "stitch");

const usage = `
Usage:
  node tools/stitch-concept.mjs explore [--brief path] [--project "title"] [--device DESKTOP] [--variants 4] [--range EXPLORE]
  node tools/stitch-concept.mjs refine --projectId <id> --screenId <id> --prompt "..." [--device DESKTOP]

Environment:
  STITCH_API_KEY   Required. Used only in local development.
`;

const parseArgs = (argv) => {
  const [command, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = rest[index + 1];
    options[key] = value;
    index += 1;
  }

  return { command, options };
};

const ensureApiKey = () => {
  if (!process.env.STITCH_API_KEY) {
    throw new Error("Missing STITCH_API_KEY. This tooling is local-only and requires a local environment variable.");
  }
};

const loadPrompt = async (briefPath, fallbackPrompt) => {
  if (briefPath) {
    const resolved = path.resolve(briefPath);
    return (await fs.readFile(resolved, "utf8")).trim();
  }

  return fallbackPrompt.trim();
};

const buildExplorePrompt = (briefText) => `
You are exploring high-quality UI directions for a weather decision workspace.

Non-negotiable constraints:
- Preserve the existing two-level structure: homepage and analysis workspace.
- Preserve core behaviors: multi-location switching, favorites, refresh, analysis tab switch, official image tab, 24-hour track, full model ranking, sticky model profile.
- The product's real purpose is helping users predict the day's highest temperature.
- Do not add fake modules or unsupported data.
- Data must stay visually dominant over decoration.
- Homepage should be a focused decision entrypoint.
- Analysis page should remain a high-density professional workbench.

Please create several clearly different design candidates while respecting those boundaries.

Context:
${briefText}
`.trim();

const writeArtifacts = async ({ outputDir, projectId, primary, variants }) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const targetDir = path.join(outputDir, `${stamp}-${projectId}`);
  await fs.mkdir(targetDir, { recursive: true });

  const saved = [];
  const saveScreen = async (screen, prefix) => {
    const htmlUrl = await screen.getHtml();
    const imageUrl = await screen.getImage();
    const record = {
      screenId: screen.id,
      htmlUrl,
      imageUrl,
    };
    const file = path.join(targetDir, `${prefix}.json`);
    await fs.writeFile(file, JSON.stringify(record, null, 2), "utf8");
    saved.push(file);
  };

  await saveScreen(primary, "primary");
  for (let index = 0; index < variants.length; index += 1) {
    await saveScreen(variants[index], `variant-${index + 1}`);
  }

  return {
    targetDir,
    saved,
  };
};

const runExplore = async (options) => {
  ensureApiKey();

  const { stitch } = await import("@google/stitch-sdk");
  const projectTitle = options.project ?? `Weather Decision Concepts ${new Date().toISOString().slice(0, 10)}`;
  const brief = await loadPrompt(
    options.brief,
    `
Reimagine the frontend shell and weather workspace as a premium desktop-first product surface.
Use one shared design system across homepage and analysis page, but allow different density.
The homepage should emphasize highest-temperature judgment and short-term evolution.
The analysis page should restore full ranking as the main path with a sticky model inspector.
The background can have subtle spatial atmosphere, but it must never overpower the data.
    `,
  );

  const variantCount = Number.parseInt(options.variants ?? String(DEFAULT_VARIANT_COUNT), 10);
  if (!VALID_VARIANT_COUNT.has(variantCount)) {
    throw new Error("variants must be one of 3, 4, or 5.");
  }

  const creativeRange = (options.range ?? DEFAULT_CREATIVE_RANGE).toUpperCase();
  if (!VALID_CREATIVE_RANGES.has(creativeRange)) {
    throw new Error("range must be REFINE, EXPLORE, or REIMAGINE.");
  }

  const deviceType = (options.device ?? "DESKTOP").toUpperCase();
  const project = await stitch.createProject(projectTitle);
  const screen = await project.generate(buildExplorePrompt(brief), deviceType);
  const variants = await screen.variants("Explore clearly different but production-minded directions.", {
    variantCount,
    creativeRange,
  }, deviceType);

  const { targetDir, saved } = await writeArtifacts({
    outputDir: DEFAULT_OUTPUT_DIR,
    projectId: project.id,
    primary: screen,
    variants,
  });

  const summary = {
    mode: "explore",
    projectId: project.id,
    projectTitle,
    targetDir,
    artifacts: saved,
  };

  const summaryFile = path.join(targetDir, "summary.json");
  await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
};

const runRefine = async (options) => {
  ensureApiKey();
  if (!options.projectId || !options.screenId || !options.prompt) {
    throw new Error("refine mode requires --projectId, --screenId, and --prompt.");
  }

  const { stitch } = await import("@google/stitch-sdk");
  const project = stitch.project(options.projectId);
  const screen = await project.getScreen(options.screenId);
  const refined = await screen.edit(options.prompt, (options.device ?? "DESKTOP").toUpperCase());
  const targetDir = path.join(DEFAULT_OUTPUT_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${project.id}-refine`);
  await fs.mkdir(targetDir, { recursive: true });

  const result = {
    mode: "refine",
    projectId: project.id,
    screenId: refined.id,
    htmlUrl: await refined.getHtml(),
    imageUrl: await refined.getImage(),
  };

  const file = path.join(targetDir, "refined.json");
  await fs.writeFile(file, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify({ ...result, artifact: file }, null, 2));
};

const main = async () => {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || command === "--help" || command === "-h") {
    console.log(usage.trim());
    return;
  }

  if (command === "explore") {
    await runExplore(options);
    return;
  }

  if (command === "refine") {
    await runRefine(options);
    return;
  }

  throw new Error(`Unknown command '${command}'.`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
