import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { resolveSourceReadState } from "../lib/source-read-state";
import { HomeReferenceCard } from "./HomeReferenceCard";

type HomeReferenceCardProps = Parameters<typeof HomeReferenceCard>[0];
type InsightInput = NonNullable<HomeReferenceCardProps["insight"]>;

const countText = (markup: string, needle: string) => markup.split(needle).length - 1;

const READ_CLASS = resolveSourceReadState("fresh", true).className;
const UNREAD_CLASS = resolveSourceReadState("fresh", false).className;
const PENDING_CLASS = resolveSourceReadState("revalidating", false).className;

const buildInsight = (overrides: Partial<InsightInput> = {}): InsightInput => ({
  fetchedAt: "2026-05-06T08:05:00.000Z",
  freshness: "fresh",
  modelCount: 3,
  pageUrl: "https://example.com/multimodel",
  rankedModels: [
    {
      modelName: "ECMWF",
      currentTemperatureC: 20,
      deltaToActualTemperatureC: 0.2,
      dayPeakTemperatureC: 24,
      dayPeakTimestamp: "2026-05-06T14:00:00.000Z",
    },
  ],
  sourceProof: {
    dataFromPage: true,
    usesOfficialApi: false,
    chartFormat: "highcharts",
    pageFetchedAt: "2026-05-06T08:00:00.000Z",
    chartEndpoint: "/multimodel/chart",
    parserVersion: "test",
    modelNames: ["ECMWF", "GFS", "ICON"],
    timestampCount: 24,
    timestampSource: "point-name-local",
    xLabelOffsetMinutes: null,
  },
  ...overrides,
});

const baseProps: HomeReferenceCardProps = {
  hourly: {
    fetchedAt: "2026-05-06T08:00:00.000Z",
    sourceObservedAt: null,
    freshness: "fresh",
    pageUrl: "https://example.com/hourly",
    sourceType: "week-meteogram-highcharts",
    items: [],
  },
  metar: null,
  taf: null,
  report: {
    fetchedAt: "2026-05-06T08:00:00.000Z",
    sourceObservedAt: null,
    freshness: "fresh",
    pageUrl: "https://example.com/report",
  },
  multimodel: {
    displayUpdatedAt: "2026-05-06T07:58:00.000Z",
    freshness: "fresh",
    imageFetchedAt: "2026-05-06T07:59:00.000Z",
    pageFetchedAt: "2026-05-06T08:00:00.000Z",
    pageUrl: "https://example.com/multimodel",
  },
  insight: null,
  sourceMetadata: {
    contract: {
      contractVersion: "test",
      rolloutTier: "tier-1",
      settlementReference: {
        label: "Seattle",
        kind: "airport-reference",
        stationCode: "KSEA",
        detail: "test settlement reference",
      },
      currentSources: {
        baselineForecast: {
          key: "baselineForecast",
          label: "Baseline forecast",
          status: "production",
          detail: "test baseline forecast",
          stationCode: null,
        },
        modelEnvelope: {
          key: "modelEnvelope",
          label: "Multimodel envelope",
          status: "production",
          detail: "test multimodel source",
          stationCode: null,
        },
        primaryObservation: {
          key: "primaryObservation",
          label: "Primary observation",
          status: "production",
          detail: "test primary observation",
          stationCode: "KSEA",
        },
      },
      targetUpgrades: {
        openMeteoMultiModel: {
          key: "openMeteoMultiModel",
          label: "OpenMeteo multimodel",
          status: "planned",
          detail: "test multimodel upgrade",
          stationCode: null,
        },
        taf: {
          key: "taf",
          label: "TAF",
          status: "planned",
          detail: "test taf upgrade",
          stationCode: "KSEA",
          role: "airport-disruption-confirmation",
        },
        officialEnhancements: [],
      },
      peakWindowLocal: {
        startHour: 12,
        endHour: 17,
        rationale: "test peak window",
      },
      kellyMarketMapping: {
        status: "planned",
        detail: "test market mapping",
      },
    },
    freshness: {
      hourly: "fresh",
      report: "fresh",
      multimodel: "fresh",
    },
  },
  pageUrl: "https://example.com/hourly",
  displayUnit: "C",
  locationTimezone: "UTC",
};

const renderCard = (overrides: Partial<HomeReferenceCardProps> = {}) =>
  renderToStaticMarkup(<HomeReferenceCard {...baseProps} {...overrides} />);

test("keeps multimodel unread when only scrape markers exist", () => {
  const markup = renderCard();

  expect(markup).toContain(">0/4 ");
  expect(countText(markup, READ_CLASS)).toBe(0);
  expect(countText(markup, UNREAD_CLASS)).toBe(4);
});

test("keeps multimodel unread when insight has no usable model analysis", () => {
  const markup = renderCard({
    insight: buildInsight({
      modelCount: 0,
      rankedModels: [],
      sourceProof: {
        ...buildInsight().sourceProof,
        modelNames: [],
      },
    }),
  });

  expect(markup).toContain(">0/4 ");
  expect(countText(markup, READ_CLASS)).toBe(0);
  expect(countText(markup, UNREAD_CLASS)).toBe(4);
});

test("shows multimodel as pending while analysis is still revalidating", () => {
  const markup = renderCard({
    multimodel: {
      ...baseProps.multimodel,
      freshness: "revalidating",
    },
  });

  expect(markup).toContain(">0/4 ");
  expect(countText(markup, READ_CLASS)).toBe(0);
  expect(countText(markup, PENDING_CLASS)).toBe(1);
  expect(countText(markup, UNREAD_CLASS)).toBe(3);
});

test("shows multimodel as read only after real insight data is available", () => {
  const markup = renderCard({
    insight: buildInsight(),
  });

  expect(markup).toContain(">1/4 ");
  expect(countText(markup, READ_CLASS)).toBe(1);
  expect(countText(markup, UNREAD_CLASS)).toBe(3);
});
