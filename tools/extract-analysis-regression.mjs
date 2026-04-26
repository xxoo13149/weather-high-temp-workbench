import { execFileSync } from "node:child_process";

const out = execFileSync(process.execPath, ["tools/debug-location-switch.mjs", "analysis-regression"], {
  cwd: "D:/weather",
  encoding: "utf8",
  maxBuffer: 30 * 1024 * 1024,
});

const data = JSON.parse(out);
const scenario = data.scenarios["analysis-regression"];

const summarizeSnapshot = (snapshot) =>
  snapshot
    ? {
        title: snapshot.title ?? null,
        href: snapshot.href ?? null,
        syncState: snapshot.syncState ?? null,
        refreshState: snapshot.refreshState ?? null,
        refreshLabel: snapshot.refreshLabel ?? null,
        transition: snapshot.transition ?? null,
        hasTimeout: snapshot.hasTimeout ?? null,
        hasAnalysisSyncing: snapshot.hasAnalysisSyncing ?? null,
        analysisArticleCount: snapshot.analysisArticleCount ?? null,
        analysisFingerprint: snapshot.analysisFingerprint ?? null,
        weatherTimestamp: snapshot.weatherTimestamp ?? null,
        modelTimestamp: snapshot.modelTimestamp ?? null,
      }
    : null;

console.log(
  JSON.stringify(
    {
      initial: summarizeSnapshot(scenario.initialSnapshot),
      locationSteps:
        scenario.locationSteps?.map((step) => ({
          targetCode: step.targetCode,
          expectedLocationId: step.expectedLocationId ?? null,
          skipped: Boolean(step.skipped),
          ok: step.ok ?? null,
          failureReasons: step.failureReasons ?? [],
          trafficSummary: step.trafficSummary ?? null,
          final: summarizeSnapshot(step.finalSnapshot ?? step.beforeSnapshot),
          traffic: step.weatherTraffic ?? [],
        })) ?? [],
      refreshAttempts:
        scenario.refreshAttempts?.map((attempt) => ({
          ok: attempt.ok,
          failureReasons: attempt.failureReasons ?? [],
          refreshStateChanged: attempt.refreshStateChanged,
          contentChanged: attempt.contentChanged,
          after: summarizeSnapshot(attempt.afterSnapshot),
        })) ?? [],
      navigation: {
        toKellyOk: scenario.navigation?.toKelly?.ok ?? null,
        backToAnalysisOk: scenario.navigation?.backToAnalysis?.ok ?? null,
        backToAnalysis: summarizeSnapshot(scenario.navigation?.backToAnalysis?.finalSnapshot),
      },
    },
    null,
    2,
  ),
);
