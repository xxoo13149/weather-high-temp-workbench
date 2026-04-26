const { pathToFileURL } = require("node:url");
const path = require("node:path");

const parseArgs = (argv) => {
  const options = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) {
      continue;
    }

    const [key, value] = raw.slice(2).split("=", 2);
    options[key] = value ?? "true";
  }

  return options;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const shared = await import(pathToFileURL(path.join(__dirname, "playwright-location-regression.shared.js")).href);
  const result = await shared.runRegressionSuites({
    suite: options.suite ?? "local-full",
    baseUrl: options.baseUrl ?? process.env.PLAYWRIGHT_BASE_URL ?? shared.DEFAULT_BASE_URL,
    headless: options.headless ? options.headless !== "false" : process.env.PLAYWRIGHT_HEADLESS !== "false",
  });

  console.log(JSON.stringify(result, null, 2));

  const failed =
    (result.analysisSwitch && result.analysisSwitch.ok === false) ||
    (result.analysisAll && result.analysisAll.ok === false) ||
    (result.kellyAll && result.kellyAll.ok === false) ||
    (result.kellySwitch && result.kellySwitch.ok === false) ||
    (result.kellyPressure && result.kellyPressure.ok === false) ||
    (result.onlineSmoke && result.onlineSmoke.ok === false);
  if (failed) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
