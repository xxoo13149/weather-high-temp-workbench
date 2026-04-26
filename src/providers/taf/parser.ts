import type {
  TafCloudLayerDetail,
  TafDailySummary,
  TafPhenomenon,
  TafPhenomenonCategory,
  TafTemperatureExtreme,
  TafTemperatureTrendSummary,
  TafForecastSegment,
  TafTrendSummary,
  TafWindShearSummary,
} from "../../domain/weather.js";

type TemperatureContext = {
  issuedAt?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
};

const CHANGE_TOKEN_RE = /^(FM\d{6}|TEMPO|BECMG|PROB\d{2})$/;
const VALIDITY_TOKEN_RE = /^\d{4}\/\d{4}$/;
const TEMPERATURE_TOKEN_RE = /^(TX|TN)(M?\d{2})\/(\d{2})(\d{2})Z$/;
const WIND_SHEAR_TOKEN_RE = /^WS(\d{3})\/(VRB|\d{3})(\d{2,3})KT$/;
const WEATHER_DESCRIPTOR_CODES = ["MI", "BC", "PR", "DR", "BL", "SH", "TS", "FZ"] as const;
const WEATHER_PHENOMENA_CODES = [
  "DZ",
  "RA",
  "SN",
  "SG",
  "IC",
  "PL",
  "GR",
  "GS",
  "UP",
  "BR",
  "FG",
  "FU",
  "VA",
  "DU",
  "SA",
  "HZ",
  "PY",
  "PO",
  "SQ",
  "FC",
  "SS",
  "DS",
] as const;

const WEATHER_DESCRIPTOR_SET = new Set<string>(WEATHER_DESCRIPTOR_CODES);
const WEATHER_PHENOMENA_SET = new Set<string>(WEATHER_PHENOMENA_CODES);

const CLOUD_COVER_LABEL_ZH: Record<string, string> = {
  CAVOK: "CAVOK 放晴",
  FEW: "少云",
  SCT: "疏云",
  BKN: "多云",
  OVC: "阴云",
  VV: "垂直能见度",
  SKC: "晴空",
  NSC: "无显著云",
  NCD: "无云",
};

const CLOUD_TYPE_LABEL_ZH: Record<string, string> = {
  CB: "积雨云",
  TCU: "浓积云",
};

const PHENOMENON_LABEL_ZH: Record<string, string> = {
  DZ: "毛毛雨",
  RA: "雨",
  SN: "雪",
  SG: "米雪",
  IC: "冰晶",
  PL: "冰粒",
  GR: "冰雹",
  GS: "小冰雹",
  UP: "未知降水",
  BR: "轻雾",
  FG: "雾",
  FU: "烟",
  VA: "火山灰",
  DU: "扬尘",
  SA: "沙",
  HZ: "霾",
  PY: "水沫",
  PO: "尘卷风",
  SQ: "飑",
  FC: "漏斗云",
  SS: "沙暴",
  DS: "尘暴",
};

const degreesToWindLabelZh = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "变向风";
  }

  const normalized = ((value % 360) + 360) % 360;
  const labels = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  const index = Math.round(normalized / 45) % labels.length;
  return `${labels[index]}风`;
};

const formatTemperatureC = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return `${value}°C`;
};

const normalizeRawTaf = (rawTaf: string | null | undefined) =>
  typeof rawTaf === "string" ? rawTaf.replace(/=/g, " ").replace(/\s+/g, " ").trim() : "";

const buildCloudLayerDetail = (raw: string): TafCloudLayerDetail => {
  const normalized = raw.trim().toUpperCase();
  if (normalized === "CAVOK") {
    return {
      raw: normalized,
      cover: "CAVOK",
      baseFt: null,
      cloudType: null,
    };
  }

  const match = /^(VV|FEW|SCT|BKN|OVC|SKC|NSC|NCD)(\d{3}|\/\/\/)?([A-Z]+)?$/.exec(normalized);

  if (!match) {
    return {
      raw: normalized,
      cover: normalized.slice(0, 3),
      baseFt: null,
      cloudType: null,
    };
  }

  const [, cover, base, cloudType] = match;
  return {
    raw: normalized,
    cover,
    baseFt: base && /^\d{3}$/.test(base) ? Number.parseInt(base, 10) * 100 : null,
    cloudType: cloudType ?? null,
  };
};

const describeCloudLayerZh = (layer: TafCloudLayerDetail) => {
  const coverLabel = CLOUD_COVER_LABEL_ZH[layer.cover] ?? layer.cover;
  const baseLabel = layer.baseFt ? `${layer.baseFt}ft` : null;
  const typeLabel = layer.cloudType ? CLOUD_TYPE_LABEL_ZH[layer.cloudType] ?? layer.cloudType : null;

  return [coverLabel, baseLabel, typeLabel].filter((value): value is string => Boolean(value)).join(" ");
};

const buildWeatherPhenomenon = (rawToken: string): TafPhenomenon | null => {
  const raw = rawToken.trim().toUpperCase();
  if (!raw) {
    return null;
  }

  if (raw === "NSW") {
    return {
      raw,
      code: raw,
      labelZh: "无显著天气",
      category: "other",
    };
  }

  if (raw === "VCTS") {
    return {
      raw,
      code: raw,
      labelZh: "附近雷暴",
      category: "thunderstorm",
    };
  }

  if (raw === "TS") {
    return {
      raw,
      code: raw,
      labelZh: "雷暴",
      category: "thunderstorm",
    };
  }

  let remaining = raw;
  let intensityLabel = "";
  if (remaining.startsWith("+")) {
    intensityLabel = "强";
    remaining = remaining.slice(1);
  } else if (remaining.startsWith("-")) {
    intensityLabel = "弱";
    remaining = remaining.slice(1);
  }

  let vicinity = false;
  if (remaining.startsWith("VC")) {
    vicinity = true;
    remaining = remaining.slice(2);
  }

  const descriptors: string[] = [];
  while (remaining.length >= 2) {
    const token = remaining.slice(0, 2);
    if (!WEATHER_DESCRIPTOR_SET.has(token)) {
      break;
    }
    descriptors.push(token);
    remaining = remaining.slice(2);
  }

  const phenomena: string[] = [];
  while (remaining.length >= 2) {
    const token = remaining.slice(0, 2);
    if (!WEATHER_PHENOMENA_SET.has(token)) {
      break;
    }
    phenomena.push(token);
    remaining = remaining.slice(2);
  }

  if (remaining.length > 0) {
    return null;
  }

  const descriptorSet = new Set(descriptors);
  const phenomenonSet = new Set(phenomena);
  let category: TafPhenomenonCategory = "other";
  if (descriptorSet.has("TS")) {
    category = "thunderstorm";
  } else if (phenomena.some((code) => ["BR", "FG", "FU", "VA", "DU", "SA", "HZ", "PY"].includes(code))) {
    category = "visibility";
  } else if (phenomena.some((code) => ["PO", "SQ", "FC", "SS", "DS"].includes(code))) {
    category = "wind";
  } else if (phenomena.some((code) => ["DZ", "RA", "SN", "SG", "IC", "PL", "GR", "GS", "UP"].includes(code))) {
    category = "precipitation";
  }

  if (phenomena.length === 0 && !descriptorSet.has("TS")) {
    return null;
  }

  let mainLabel = phenomena.map((code) => PHENOMENON_LABEL_ZH[code] ?? code).join("");
  if (descriptorSet.has("TS")) {
    if (phenomenonSet.size === 0) {
      mainLabel = "雷暴";
    } else if (phenomenonSet.has("RA")) {
      mainLabel = "雷雨";
    } else if (phenomenonSet.has("SN")) {
      mainLabel = "雷阵雪";
    } else {
      mainLabel = "雷暴";
    }
  } else if (descriptorSet.has("SH")) {
    if (phenomenonSet.has("RA")) {
      mainLabel = "阵雨";
    } else if (phenomenonSet.has("SN")) {
      mainLabel = "阵雪";
    } else {
      mainLabel = `阵性${mainLabel}`;
    }
  } else if (descriptorSet.has("FZ")) {
    mainLabel = `冻${mainLabel}`;
  } else if (descriptorSet.has("BL")) {
    mainLabel = `高吹${mainLabel}`;
  } else if (descriptorSet.has("DR")) {
    mainLabel = `低吹${mainLabel}`;
  } else if (descriptorSet.has("BC")) {
    mainLabel = `片状${mainLabel}`;
  } else if (descriptorSet.has("MI")) {
    mainLabel = `浅薄${mainLabel}`;
  } else if (descriptorSet.has("PR")) {
    mainLabel = `局部${mainLabel}`;
  }

  const labelZh = `${vicinity ? "附近" : ""}${intensityLabel}${mainLabel}`;
  return {
    raw,
    code: raw,
    labelZh,
    category,
  };
};

const dedupePhenomena = (values: TafPhenomenon[]) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.code)) {
      return false;
    }
    seen.add(value.code);
    return true;
  });
};

const isVisibilityToken = (token: string) =>
  /^(P?\d{1,2}(?:\/\d{1,2})?SM|\d{4}|CAVOK)$/i.test(token.trim());

const isWindToken = (token: string) =>
  /^(?:VRB|\d{3})\d{2,3}(?:G\d{2,3})?(?:KT|MPS)$/i.test(token.trim());

const isCloudToken = (token: string) =>
  /^(?:VV|FEW|SCT|BKN|OVC|SKC|NSC|NCD)(?:\d{3}|\/\/\/)?(?:CB|TCU)?$/i.test(token.trim());

const isTimeWindowToken = (token: string) => /^\d{4}\/\d{4}$/.test(token.trim());

const isSkyConditionToken = (token: string) => {
  const normalized = token.trim().toUpperCase();
  return normalized === "CAVOK" || isCloudToken(normalized);
};

const mergeCloudLayers = (layers: TafCloudLayerDetail[]) => {
  const seen = new Set<string>();
  return layers.filter((layer) => {
    const key = layer.raw.toUpperCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const splitRawForecastSegments = (rawTaf: string | null | undefined) => {
  const normalized = normalizeRawTaf(rawTaf);
  if (!normalized) {
    return [] as string[][];
  }

  const tokens = normalized.split(" ");
  const validityIndex = tokens.findIndex((token) => VALIDITY_TOKEN_RE.test(token));
  if (validityIndex < 0) {
    return [];
  }

  const bodyTokens = tokens.slice(validityIndex + 1);
  const segments: string[][] = [[]];

  for (let index = 0; index < bodyTokens.length; index += 1) {
    const token = bodyTokens[index].trim().toUpperCase();
    if (!token || TEMPERATURE_TOKEN_RE.test(token)) {
      continue;
    }

    if (CHANGE_TOKEN_RE.test(token)) {
      const nextSegment = [token];
      if (/^PROB\d{2}$/.test(token) && bodyTokens[index + 1]?.trim().toUpperCase() === "TEMPO") {
        nextSegment.push("TEMPO");
        index += 1;
      }
      segments.push(nextSegment);
      continue;
    }

    segments[segments.length - 1]?.push(token);
  }

  return segments.filter((segment) => segment.length > 0);
};

const alignRawSegmentsToForecasts = (rawSegments: string[][], forecastCount: number) => {
  if (forecastCount <= 0) {
    return [] as string[][];
  }

  if (rawSegments.length === forecastCount) {
    return rawSegments;
  }

  if (rawSegments.length === forecastCount + 1 && rawSegments[0]?.length === 0) {
    return rawSegments.slice(1);
  }

  if (rawSegments.length < forecastCount) {
    return [...rawSegments, ...Array.from({ length: forecastCount - rawSegments.length }, () => [])];
  }

  return rawSegments.slice(0, forecastCount);
};

const parseWindShear = (tokens: string[]): TafWindShearSummary | null => {
  const raw = tokens.find((token) => WIND_SHEAR_TOKEN_RE.test(token));
  if (!raw) {
    return null;
  }

  const match = WIND_SHEAR_TOKEN_RE.exec(raw);
  if (!match) {
    return null;
  }

  return {
    raw,
    heightFtAgl: Number.parseInt(match[1], 10) * 100,
    directionDegrees: match[2] === "VRB" ? null : Number.parseInt(match[2], 10),
    speedKts: Number.parseInt(match[3], 10),
  };
};

const parseTemperatureExtremes = (rawTaf: string | null | undefined, context: TemperatureContext): TafTemperatureExtreme[] => {
  const normalized = normalizeRawTaf(rawTaf);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(" ")
    .map((token) => {
      const match = TEMPERATURE_TOKEN_RE.exec(token.trim().toUpperCase());
      if (!match) {
        return null;
      }

      const rawValue = match[2];
      const value = rawValue.startsWith("M") ? -Number.parseInt(rawValue.slice(1), 10) : Number.parseInt(rawValue, 10);
      const occursAt = resolveTokenDayHourToIso(
        Number.parseInt(match[3], 10),
        Number.parseInt(match[4], 10),
        context,
      );

      return {
        raw: token.trim().toUpperCase(),
        kind: match[1] === "TX" ? "max" : "min",
        temperatureC: value,
        occursAt,
      } satisfies TafTemperatureExtreme;
    })
    .filter((value): value is TafTemperatureExtreme => Boolean(value));
};

const buildTemperatureTrendSummary = (
  temperatureExtremes: TafTemperatureExtreme[],
): TafTemperatureTrendSummary | null => {
  if (temperatureExtremes.length === 0) {
    return null;
  }

  const timedExtremes = [...temperatureExtremes]
    .filter((item) => Boolean(item.occursAt))
    .sort((left, right) => {
      const leftTime = left.occursAt ? new Date(left.occursAt).getTime() : Number.POSITIVE_INFINITY;
      const rightTime = right.occursAt ? new Date(right.occursAt).getTime() : Number.POSITIVE_INFINITY;
      return leftTime - rightTime;
    });

  const now = Date.now();
  const nextExtreme = timedExtremes.find((item) => item.occursAt && new Date(item.occursAt).getTime() >= now) ?? null;
  const latestExtreme =
    [...timedExtremes].reverse().find((item) => item.occursAt && new Date(item.occursAt).getTime() <= now) ?? null;

  const buildPointLabel = (point: TafTemperatureExtreme | null) => {
    if (!point) {
      return null;
    }

    const temperatureLabel = formatTemperatureC(point.temperatureC);
    const kindLabel = point.kind === "max" ? "高温" : "低温";
    return temperatureLabel ? `${kindLabel} ${temperatureLabel}` : kindLabel;
  };

  const futureLabel = buildPointLabel(nextExtreme);
  const pastLabel = buildPointLabel(latestExtreme);

  if (nextExtreme && latestExtreme && nextExtreme.kind !== latestExtreme.kind) {
    if (latestExtreme.kind === "max" && nextExtreme.kind === "min") {
      return {
        headlineZh: "高温已过，后段转入回落",
        detailZh: `${pastLabel ?? "高温已过"} 已兑现，后段重点看回落节奏。`,
        currentPhaseZh: "高温已过，回落中",
        nextTurningPointKind: nextExtreme.kind,
        nextTurningPointAt: nextExtreme.occursAt,
        nextTurningPointTemperatureC: nextExtreme.temperatureC,
      };
    }

    if (latestExtreme.kind === "min" && nextExtreme.kind === "max") {
      return {
        headlineZh: "低温已过，后段逐步回升",
        detailZh: `${pastLabel ?? "低温已过"} 已兑现，后段重点看回升节奏。`,
        currentPhaseZh: "低温已过，回升中",
        nextTurningPointKind: nextExtreme.kind,
        nextTurningPointAt: nextExtreme.occursAt,
        nextTurningPointTemperatureC: nextExtreme.temperatureC,
      };
    }
  }

  if (nextExtreme) {
    if (nextExtreme.kind === "max") {
      return {
        headlineZh: "温度仍在抬升，先看高温兑现",
        detailZh: `按 TAF 极值组推算，当前仍在朝 ${futureLabel ?? "高温"} 靠近。`,
        currentPhaseZh: "升温中",
        nextTurningPointKind: nextExtreme.kind,
        nextTurningPointAt: nextExtreme.occursAt,
        nextTurningPointTemperatureC: nextExtreme.temperatureC,
      };
    }

    return {
      headlineZh: "温度仍在回落，先看低温兑现",
      detailZh: `按 TAF 极值组推算，当前仍在朝 ${futureLabel ?? "低温"} 靠近。`,
      currentPhaseZh: "降温中",
      nextTurningPointKind: nextExtreme.kind,
      nextTurningPointAt: nextExtreme.occursAt,
      nextTurningPointTemperatureC: nextExtreme.temperatureC,
    };
  }

  if (latestExtreme?.kind === "max") {
    return {
      headlineZh: "高温已过，后段重点看风云变化",
      detailZh: pastLabel ? `${pastLabel} 已兑现，后段更多关注风、云和天气现象。` : "高温已兑现，后段更多关注风、云和天气现象。",
      currentPhaseZh: "高温已过",
      nextTurningPointKind: null,
      nextTurningPointAt: null,
      nextTurningPointTemperatureC: null,
    };
  }

  if (latestExtreme?.kind === "min") {
    return {
      headlineZh: "低温已过，后段重点看回升节奏",
      detailZh: pastLabel ? `${pastLabel} 已兑现，后段重点看回升节奏与天气扰动。` : "低温已兑现，后段重点看回升节奏与天气扰动。",
      currentPhaseZh: "低温已过",
      nextTurningPointKind: null,
      nextTurningPointAt: null,
      nextTurningPointTemperatureC: null,
    };
  }

  const fallbackPoint = temperatureExtremes[0] ?? null;
  return fallbackPoint
    ? {
        headlineZh: fallbackPoint.kind === "max" ? "本轮先看高温兑现" : "本轮先看低温兑现",
        detailZh: `按 TAF 极值组推算，重点关注 ${buildPointLabel(fallbackPoint) ?? "极值时段"}。`,
        currentPhaseZh: null,
        nextTurningPointKind: fallbackPoint.kind,
        nextTurningPointAt: fallbackPoint.occursAt,
        nextTurningPointTemperatureC: fallbackPoint.temperatureC,
      }
    : null;
};

const resolveTokenDayHourToIso = (day: number, hour: number, context: TemperatureContext) => {
  const references = [context.validFrom, context.issuedAt, context.validTo]
    .map((value) => (value ? new Date(value) : null))
    .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()));
  const base = references[0] ?? new Date();
  const validFromTime = context.validFrom ? new Date(context.validFrom).getTime() : null;
  const validToTime = context.validTo ? new Date(context.validTo).getTime() : null;
  const targetMidpoint =
    validFromTime !== null && validToTime !== null ? (validFromTime + validToTime) / 2 : base.getTime();
  const candidates = [-1, 0, 1].map(
    (monthOffset) =>
      new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + monthOffset, day, hour, 0, 0, 0)),
  );

  const constrained = candidates.filter((candidate) => {
    const time = candidate.getTime();
    if (validFromTime === null || validToTime === null) {
      return true;
    }
    return time >= validFromTime - 36 * 60 * 60 * 1000 && time <= validToTime + 36 * 60 * 60 * 1000;
  });

  const selected = (constrained.length > 0 ? constrained : candidates)
    .sort(
      (left, right) =>
        Math.abs(left.getTime() - targetMidpoint) - Math.abs(right.getTime() - targetMidpoint),
    )[0];

  return selected ? selected.toISOString() : null;
};

const buildSegmentWeather = (tokens: string[]) =>
  dedupePhenomena(
    tokens
      .filter(
        (token) =>
          !CHANGE_TOKEN_RE.test(token) &&
          !isTimeWindowToken(token) &&
          !isVisibilityToken(token) &&
          !isWindToken(token) &&
          !isCloudToken(token) &&
          !WIND_SHEAR_TOKEN_RE.test(token),
      )
      .map((token) => buildWeatherPhenomenon(token))
      .filter((value): value is TafPhenomenon => Boolean(value)),
  );

const buildSegmentWindTextZh = (segment: Pick<TafForecastSegment, "windDirectionDegrees" | "windSpeedKts" | "windGustKts" | "windShear">) => {
  if (typeof segment.windSpeedKts !== "number" || !Number.isFinite(segment.windSpeedKts)) {
    return segment.windShear ? "存在低空风切变" : null;
  }

  const gustText =
    typeof segment.windGustKts === "number" && Number.isFinite(segment.windGustKts)
      ? `，阵风 ${segment.windGustKts}kt`
      : "";
  const shearText = segment.windShear?.heightFtAgl ? `，低空风切变 ${segment.windShear.heightFtAgl}ft` : "";
  return `${degreesToWindLabelZh(segment.windDirectionDegrees)} ${segment.windSpeedKts}kt${gustText}${shearText}`;
};

const buildSegmentCloudTextZh = (segment: Pick<TafForecastSegment, "cloudLayers">) => {
  const layers = segment.cloudLayers ?? [];
  if (layers.length === 0) {
    return null;
  }

  return layers.slice(0, 2).map((layer) => describeCloudLayerZh(layer)).join(" / ");
};

const buildSegmentWeatherTextZh = (segment: Pick<TafForecastSegment, "weather">) => {
  const weather = segment.weather ?? [];
  if (weather.length === 0) {
    return null;
  }

  return weather.slice(0, 2).map((item) => item.labelZh).join("、");
};

const buildSegmentHeadlineZh = (
  segment: Pick<
    TafForecastSegment,
    "weather" | "windDirectionDegrees" | "windSpeedKts" | "windGustKts" | "windShear" | "cloudLayers" | "visibilityKm"
  >,
) => {
  const weatherText = buildSegmentWeatherTextZh(segment);
  const windText = buildSegmentWindTextZh(segment);
  const cloudText = buildSegmentCloudTextZh(segment);
  const visibilityText =
    typeof segment.visibilityKm === "number" && Number.isFinite(segment.visibilityKm) && segment.visibilityKm < 10
      ? `能见度 ${segment.visibilityKm.toFixed(1)}km`
      : null;

  const pieces = [weatherText, visibilityText, windText, cloudText].filter((value): value is string => Boolean(value));
  return pieces.length > 0 ? pieces.slice(0, 3).join(" · ") : null;
};

export const buildTafSegmentEnrichments = ({
  rawTaf,
  forecasts,
}: {
  rawTaf: string | null | undefined;
  forecasts: TafForecastSegment[];
}) => {
  const rawSegments = alignRawSegmentsToForecasts(splitRawForecastSegments(rawTaf), forecasts.length);

  return forecasts.map((forecast, index) => {
    const tokens = rawSegments[index] ?? [];
    const cloudLayers = mergeCloudLayers([
      ...forecast.clouds.map((layer) => buildCloudLayerDetail(layer)),
      ...tokens.filter(isSkyConditionToken).map((token) => buildCloudLayerDetail(token)),
    ]);
    const weather = dedupePhenomena([
      ...buildSegmentWeather(tokens),
      ...(forecast.weatherCodes ?? [])
        .map((code) => buildWeatherPhenomenon(code))
        .filter((value): value is TafPhenomenon => Boolean(value)),
    ]);
    const windShear = parseWindShear(tokens);
    const weatherCodes = weather.length > 0 ? weather.map((item) => item.code) : forecast.weatherCodes;

    const enrichedSegment: TafForecastSegment = {
      ...forecast,
      clouds: cloudLayers.length > 0 ? cloudLayers.map((layer) => layer.raw) : forecast.clouds,
      cloudLayers,
      weatherCodes,
      weather,
      windShear,
    };

    return {
      ...enrichedSegment,
      headlineZh: buildSegmentHeadlineZh(enrichedSegment),
    } satisfies TafForecastSegment;
  });
};

export const buildTafDailySummary = ({
  issuedAt,
  validFrom,
  validTo,
  rawTaf,
  forecasts,
  activeForecastIndex,
}: {
  issuedAt?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  rawTaf: string | null | undefined;
  forecasts: TafForecastSegment[];
  activeForecastIndex: number;
}): TafDailySummary | null => {
  if (forecasts.length === 0 && !rawTaf) {
    return null;
  }

  const temperatureExtremes = parseTemperatureExtremes(rawTaf, {
    issuedAt,
    validFrom,
    validTo,
  });
  const maxTemperatures = temperatureExtremes
    .filter((item) => item.kind === "max")
    .map((item) => item.temperatureC);
  const minTemperatures = temperatureExtremes
    .filter((item) => item.kind === "min")
    .map((item) => item.temperatureC);
  const maxTemperature = maxTemperatures.length > 0 ? Math.max(...maxTemperatures) : null;
  const minTemperature = minTemperatures.length > 0 ? Math.min(...minTemperatures) : null;
  const temperatureTrend = buildTemperatureTrendSummary(temperatureExtremes);
  const activeForecast = forecasts[activeForecastIndex] ?? forecasts[0] ?? null;
  const activeWeatherTextZh = activeForecast ? buildSegmentWeatherTextZh(activeForecast) : null;
  const activeWindTextZh = activeForecast ? buildSegmentWindTextZh(activeForecast) : null;
  const activeCloudTextZh = activeForecast ? buildSegmentCloudTextZh(activeForecast) : null;
  const activeHeadlineZh = activeForecast?.headlineZh ?? null;
  const dominantWeather = dedupePhenomena(
    forecasts.flatMap((forecast) => forecast.weather ?? []),
  ).slice(0, 4);
  const changeHighlights: TafTrendSummary[] = forecasts
    .slice(0, 4)
    .map((forecast) => ({
      changeLabel: forecast.changeLabel,
      timeFrom: forecast.timeFrom,
      timeTo: forecast.timeTo,
      headlineZh: forecast.headlineZh ?? "关注风云变化",
    }));

  const headlineParts: string[] = [];
  if (maxTemperature !== null || minTemperature !== null) {
    const temperatureLabels = [
      maxTemperature !== null ? `最高 ${formatTemperatureC(maxTemperature)}` : null,
      minTemperature !== null ? `最低 ${formatTemperatureC(minTemperature)}` : null,
    ].filter((value): value is string => Boolean(value));
    if (temperatureLabels.length > 0) {
      headlineParts.push(temperatureLabels.join("，"));
    }
  }

  if (activeHeadlineZh) {
    headlineParts.push(`当前 ${activeHeadlineZh}`);
  } else if (dominantWeather.length > 0) {
    headlineParts.push(`主要现象 ${dominantWeather.map((item) => item.labelZh).join("、")}`);
  } else {
    headlineParts.push("主要关注风、云和天气现象变化");
  }

  if (temperatureTrend?.headlineZh) {
    headlineParts.push(temperatureTrend.headlineZh);
  }

  return {
    headlineZh: headlineParts.join("；"),
    maxTemperatureC: maxTemperature,
    minTemperatureC: minTemperature,
    temperatureExtremes,
    temperatureTrend,
    dominantWeather,
    activeHeadlineZh,
    activeWeatherTextZh,
    activeWindTextZh,
    activeCloudTextZh,
    changeHighlights,
  };
};
