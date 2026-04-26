import * as shared from "./playwright-location-regression.shared.js";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const batchSizeRaw = Number.parseInt(process.env.PLAYWRIGHT_BATCH_SIZE ?? "8", 10);
const batchSize = Number.isFinite(batchSizeRaw) && batchSizeRaw > 0 ? batchSizeRaw : 8;

const locations = await shared.readEnabledLocations();
const batches = [];

for (let index = 0; index < locations.length; index += batchSize) {
  const batchLocations = locations.slice(index, index + batchSize);
  const result = await shared.runRegressionSuites({
    suite: "kelly-all",
    baseUrl,
    locations: batchLocations,
  });
  const failures = (result.kellyAll?.failures ?? []).map((item) => item.locationId);
  const row = {
    batch: `${index + 1}-${index + batchLocations.length}`,
    ok: Boolean(result.kellyAll?.ok),
    failureCount: failures.length,
    failures,
    artifactDir: result.artifactDir,
  };
  batches.push(row);
  console.log(JSON.stringify(row));
}

const failed = batches.filter((item) => !item.ok);
const summary = {
  totalBatches: batches.length,
  failedBatches: failed.length,
  failed,
};
console.log(`SUMMARY ${JSON.stringify(summary, null, 2)}`);

if (failed.length > 0) {
  process.exitCode = 1;
}
