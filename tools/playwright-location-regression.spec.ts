import fs from "node:fs/promises";
import path from "node:path";

import {
  ANALYSIS_SWITCH_SEQUENCE,
  DEFAULT_BASE_URL,
  KELLY_SWITCH_SEQUENCE,
  collectPageState,
  createRequestTracker,
  loadPlaywrightTestApi,
  readEnabledLocations,
  settleRefreshButton,
  switchLocationBySearch,
  waitForAnalysisReady,
  waitForKellyReady,
  waitForLocationTitle,
  writeScenarioArtifacts,
} from "./playwright-location-regression.shared.js";

const { expect, test } = await loadPlaywrightTestApi();

test.describe.configure({ mode: "serial" });

const createTestArtifactDir = async (testInfo, name) => {
  const dir = path.dirname(testInfo.outputPath(`${name}.tmp`));
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

test("Playwright: analysis switch + dwell regression", async ({ page }, testInfo) => {
  const tracker = createRequestTracker(page);

  try {
    await page.goto(`${DEFAULT_BASE_URL}/analysis?locationId=${ANALYSIS_SWITCH_SEQUENCE[0].id}`, {
      waitUntil: "domcontentloaded",
    });
    await waitForLocationTitle(page, ANALYSIS_SWITCH_SEQUENCE[0]);
    await waitForAnalysisReady(page, tracker, ANALYSIS_SWITCH_SEQUENCE[0].id);

    for (const location of ANALYSIS_SWITCH_SEQUENCE.slice(1)) {
      tracker.clear();
      await switchLocationBySearch(page, location);
      await waitForAnalysisReady(page, tracker, location.id);
      await page.waitForTimeout(4_000);
    }

    tracker.clear();
    await page.waitForTimeout(12_000);
    await settleRefreshButton(page);
    const state = await waitForAnalysisReady(page, tracker, ANALYSIS_SWITCH_SEQUENCE.at(-1)?.id);

    expect(state.hasFatalText, state.bodyText).toBe(false);
    expect(state.hasAnalysisArticles, state.bodyText).toBe(true);
    expect(state.responseErrors, JSON.stringify(state.responseErrors, null, 2)).toEqual([]);
  } catch (error) {
    const state = await collectPageState(page, tracker);
    const artifacts = await writeScenarioArtifacts(page, await createTestArtifactDir(testInfo, "analysis-switch"), "analysis-switch", state, {
      error: error instanceof Error ? error.message : String(error),
    });
      await testInfo.attach("analysis-switch-state", {
        contentType: "application/json",
        path: artifacts.jsonPath,
      });
    throw error;
  } finally {
    tracker.stop();
  }
});

for (const location of await readEnabledLocations()) {
  test(`Playwright: analysis smoke ${location.id}`, async ({ page }, testInfo) => {
    const tracker = createRequestTracker(page);

    try {
      await page.goto(`${DEFAULT_BASE_URL}/analysis?locationId=${location.id}`, { waitUntil: "domcontentloaded" });
      await waitForLocationTitle(page, location);
      const state = await waitForAnalysisReady(page, tracker, location.id);

      expect(state.hasAnalysisArticles, state.bodyText).toBe(true);
      expect(state.responseErrors, JSON.stringify(state.responseErrors, null, 2)).toEqual([]);
    } catch (error) {
      const state = await collectPageState(page, tracker);
      const artifacts = await writeScenarioArtifacts(
        page,
        await createTestArtifactDir(testInfo, `analysis-${location.id}`),
        `analysis-${location.id}`,
        state,
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      await testInfo.attach(`analysis-${location.id}-state`, {
        contentType: "application/json",
        path: artifacts.jsonPath,
      });
      throw error;
    } finally {
      tracker.stop();
    }
  });
}

test("Playwright: Kelly switch + dwell regression", async ({ page }, testInfo) => {
  const tracker = createRequestTracker(page);

  try {
    await page.goto(`${DEFAULT_BASE_URL}/kelly?locationId=${KELLY_SWITCH_SEQUENCE[0].id}`, {
      waitUntil: "domcontentloaded",
    });
    await waitForLocationTitle(page, KELLY_SWITCH_SEQUENCE[0]);
    await waitForKellyReady(page, tracker, KELLY_SWITCH_SEQUENCE[0].id);

    for (const location of KELLY_SWITCH_SEQUENCE.slice(1)) {
      tracker.clear();
      await switchLocationBySearch(page, location);
      await waitForKellyReady(page, tracker, location.id);
      await page.waitForTimeout(5_000);
    }

    tracker.clear();
    await page.waitForTimeout(12_000);
    await settleRefreshButton(page);
    const state = await waitForKellyReady(page, tracker, KELLY_SWITCH_SEQUENCE.at(-1)?.id);

    expect(state.hasFatalText, state.bodyText).toBe(false);
    expect(state.hasKellyMarkets || state.hasKellyEmptyBlock || state.hasKellyShell, state.bodyText).toBe(true);
    expect(state.responseErrors, JSON.stringify(state.responseErrors, null, 2)).toEqual([]);
  } catch (error) {
    const state = await collectPageState(page, tracker);
    const artifacts = await writeScenarioArtifacts(page, await createTestArtifactDir(testInfo, "kelly-switch"), "kelly-switch", state, {
      error: error instanceof Error ? error.message : String(error),
    });
    await testInfo.attach("kelly-switch-state", {
      contentType: "application/json",
      path: artifacts.jsonPath,
    });
    throw error;
  } finally {
    tracker.stop();
  }
});
