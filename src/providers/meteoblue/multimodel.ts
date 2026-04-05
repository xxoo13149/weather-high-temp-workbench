import { load } from "cheerio";

import { AppError } from "../../domain/errors.js";

export const MULTIMODEL_IMAGE_VERSION = "2026-04-04.2";
export const MULTIMODEL_HIGHCHARTS_VERSION = "2026-04-04.2";

export interface MultiModelPageModelMeta {
  modelCode: string;
  sourceDisplayName: string;
  pageOrder: number;
  pageLastUpdatedAt: string | null;
  pageLastUpdatedLabel: string | null;
  sourceProvider: string | null;
  coverage: string | null;
  resolution: string | null;
  forecastHorizon: string | null;
}

export interface MultiModelPageInventoryResult {
  models: MultiModelPageModelMeta[];
  warnings: string[];
}

const normalizeUrl = (href: string): string => {
  const decoded = href.trim().replace(/&amp;/g, "&");
  if (decoded.startsWith("//")) {
    return `https:${decoded}`;
  }

  return new URL(decoded, "https://www.meteoblue.com").toString();
};

const normalizeText = (value: string): string =>
  value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeCode = (value: string): string =>
  normalizeText(value)
    .toUpperCase()
    .replace(/\s+/g, "");

const normalizeNameKey = (value: string): string =>
  normalizeText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const assertMultiModelImageUrl = (url: string): string => {
  if (!url.includes("/images/meteogram_multimodel") || !url.includes("format=png")) {
    throw new AppError(503, "MULTIMODEL_IMAGE_URL_INVALID", "Resolved image link does not look like a multimodel PNG export.", {
      retryable: true,
    });
  }

  return url;
};

const assertHighchartsUrl = (url: string): string => {
  if (!url.includes("/images/meteogram_multimodel") || !url.includes("format=highcharts")) {
    throw new AppError(
      503,
      "MULTIMODEL_HIGHCHARTS_URL_INVALID",
      "Resolved chart link does not look like a multimodel highcharts export.",
      {
        retryable: true,
      },
    );
  }

  return url;
};

const extractFirstAttrUrl = ($: ReturnType<typeof load>, selectors: string[], attrs: string[]): string | null => {
  for (const selector of selectors) {
    const elements = $(selector).toArray();
    for (const element of elements) {
      for (const attr of attrs) {
        const raw = $(element).attr(attr)?.trim();
        if (raw) {
          return raw;
        }
      }
    }
  }

  return null;
};

const parseLastUpdatedIso = (value: string | null): string | null => {
  const normalized = normalizeText(value ?? "");
  if (!normalized) {
    return null;
  }

  const parsedMs = Date.parse(normalized);
  if (!Number.isNaN(parsedMs)) {
    return new Date(parsedMs).toISOString();
  }

  const utcMatch = normalized.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::(\d{2}))?\s*UTC/i);
  if (utcMatch) {
    const second = utcMatch[3] ?? "00";
    const iso = `${utcMatch[1]}T${utcMatch[2]}:${second}Z`;
    const utcMs = Date.parse(iso);
    return Number.isNaN(utcMs) ? null : new Date(utcMs).toISOString();
  }

  return null;
};

export const extractMultiModelImageUrl = (html: string): string => {
  const $ = load(html);
  const preferred = $("a[href], a#chart_download[href]")
    .toArray()
    .find((element) => {
      const href = $(element).attr("href") ?? "";
      const text = $(element).text().replace(/\s+/g, " ").trim();
      return text === "Download image" && href.includes("meteogram_multimodel");
    });

  const fallback = $('a[href*="meteogram_multimodel"][href*="format=png"]')
    .toArray()
    .find((element) => {
      const href = $(element).attr("href") ?? "";
      return href.includes("download=1") || href.includes("format=png");
    });

  const candidate = preferred ? $(preferred).attr("href") : fallback ? $(fallback).attr("href") : null;
  if (!candidate) {
    throw new AppError(503, "MULTIMODEL_IMAGE_URL_NOT_FOUND", "Could not find a meteoblue multimodel image link.", {
      retryable: true,
    });
  }

  return assertMultiModelImageUrl(normalizeUrl(candidate));
};

export const extractMultiModelHighchartsUrl = (html: string): string => {
  const $ = load(html);
  const candidate = extractFirstAttrUrl(
    $,
    [
      ".highcharts[data-url]",
      ".highcharts[data-href]",
      ".blooimage[data-url]",
      ".blooimage[data-href]",
      '[data-url*="format=highcharts"]',
      '[data-href*="format=highcharts"]',
      'a[href*="format=highcharts"]',
    ],
    ["data-url", "data-href", "href"],
  );

  if (!candidate) {
    throw new AppError(
      503,
      "MULTIMODEL_HIGHCHARTS_URL_NOT_FOUND",
      "Could not find a meteoblue multimodel highcharts link.",
      {
        retryable: true,
      },
    );
  }

  return assertHighchartsUrl(normalizeUrl(candidate));
};

const parseSelectedDomainCodesFromUrl = (highchartsUrl: string): string[] => {
  try {
    const url = new URL(highchartsUrl);
    return url.searchParams
      .getAll("domains")
      .map((item) => normalizeCode(item))
      .filter((item) => item !== "");
  } catch {
    return [];
  }
};

const extractGlobalLastUpdate = ($: ReturnType<typeof load>): { at: string | null; label: string | null } => {
  const selectors = [".last-update", "th.last-update", "[data-last-update]"];
  for (const selector of selectors) {
    const node = $(selector).first();
    if (node.length === 0) {
      continue;
    }

    const fromAttr = normalizeText(node.attr("data-last-update") ?? "") || null;
    const text = normalizeText(node.text());
    const label = fromAttr ?? (text || null);
    if (!label) {
      continue;
    }

    const extracted = label.replace(/^last update\s*:?\s*/i, "");
    const iso = parseLastUpdatedIso(extracted) ?? parseLastUpdatedIso(label);
    if (iso || extracted) {
      return {
        at: iso,
        label: extracted || label,
      };
    }
  }

  return { at: null, label: null };
};

export const extractMultiModelPageInventory = (html: string): MultiModelPageInventoryResult => {
  const $ = load(html);
  const warnings: string[] = [];
  const globalLastUpdate = extractGlobalLastUpdate($);

  const tableRows = $("table.datatable tbody tr, table.multimodel-table tbody tr")
    .toArray()
    .map((row) => {
      const node = $(row);
      const modelName = normalizeText(
        node.find("td.model-name").first().text() ||
          node.find("td.model, td.name").first().text() ||
          node.find("td").first().text(),
      );
      if (!modelName) {
        return null;
      }

      const unavailable = /\bunavailable\b/i.test(node.attr("class") ?? "");
      const lastUpdatedCell = node.find("td.last-updated, td.last-update").first();
      const rowLabel = normalizeText(lastUpdatedCell.text()) || globalLastUpdate.label;
      const rowAt = parseLastUpdatedIso(lastUpdatedCell.attr("title") ?? "") ?? parseLastUpdatedIso(rowLabel) ?? globalLastUpdate.at;

      return {
        modelName,
        unavailable,
        key: normalizeNameKey(modelName),
        pageLastUpdatedAt: rowAt,
        pageLastUpdatedLabel: rowLabel || null,
        sourceProvider: normalizeText(node.find("td.provider a, td.provider, td.source a, td.source").first().text()) || null,
        coverage: normalizeText(node.find("td.coverage, td.region").first().text()) || null,
        resolution: normalizeText(node.find("td.spatial-resolution, td.resolution").first().text()) || null,
        forecastHorizon: normalizeText(node.find("td.temporal-resolution, td.horizon").first().text()) || null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const rowByKey = new Map<string, (typeof tableRows)[number]>();
  for (const row of tableRows) {
    if (!rowByKey.has(row.key) || (rowByKey.get(row.key)?.unavailable && !row.unavailable)) {
      rowByKey.set(row.key, row);
    }
  }

  const selectedFromCheckboxes = $("input[type='checkbox'][name='params[]']")
    .toArray()
    .map((input, index) => {
      const node = $(input);
      const isSelected =
        node.attr("checked") !== undefined ||
        node.attr("aria-checked") === "true" ||
        node.parent("label").hasClass("active");
      if (!isSelected) {
        return null;
      }

      const modelCode = normalizeCode(node.attr("value") ?? "");
      if (!modelCode) {
        return null;
      }

      const id = node.attr("id") ?? "";
      const byForLabel = id ? normalizeText($(`label[for='${id}']`).first().text()) : "";
      const inParentLabel = normalizeText(node.closest("label").text());
      const sourceDisplayName = byForLabel || inParentLabel || modelCode;

      return {
        modelCode,
        sourceDisplayName,
        pageOrder: index,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const highchartsUrl = (() => {
    try {
      return extractMultiModelHighchartsUrl(html);
    } catch {
      return null;
    }
  })();

  const selectedCodes =
    selectedFromCheckboxes.length > 0
      ? selectedFromCheckboxes
      : parseSelectedDomainCodesFromUrl(highchartsUrl ?? "").map((modelCode, index) => ({
          modelCode,
          sourceDisplayName: modelCode,
          pageOrder: index,
        }));

  if (selectedCodes.length === 0) {
    warnings.push("No selected model domains were found on the multimodel page.");
  }

  const models: MultiModelPageModelMeta[] = selectedCodes.map((selected) => {
    const candidates = [
      rowByKey.get(normalizeNameKey(selected.sourceDisplayName)),
      rowByKey.get(normalizeNameKey(selected.modelCode)),
    ].filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

    const best = candidates[0] ?? null;

    if (!best) {
      warnings.push(`No model table row matched selected domain ${selected.modelCode}.`);
    }

    return {
      modelCode: selected.modelCode,
      sourceDisplayName: selected.sourceDisplayName,
      pageOrder: selected.pageOrder,
      pageLastUpdatedAt: best?.pageLastUpdatedAt ?? globalLastUpdate.at,
      pageLastUpdatedLabel: best?.pageLastUpdatedLabel ?? globalLastUpdate.label,
      sourceProvider: best?.sourceProvider ?? null,
      coverage: best?.coverage ?? null,
      resolution: best?.resolution ?? null,
      forecastHorizon: best?.forecastHorizon ?? null,
    };
  });

  return {
    models,
    warnings,
  };
};
