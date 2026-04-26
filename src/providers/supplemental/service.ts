import type {
  DataFreshnessState,
  LocationInfo,
  RadarSnapshotFrame,
  SatelliteSnapshotFrame,
  SupplementalEvidenceSnapshot,
  SupplementalSourceStatus,
} from "../../domain/weather.js";
import { fetchJson } from "../../lib/http.js";

const RAINVIEWER_API_URL = "https://api.rainviewer.com/public/weather-maps.json";
const RAINVIEWER_SOURCE_URL = "https://www.rainviewer.com/api/weather-maps-api.html";
const RAINVIEWER_VIEWER_URL = "https://www.rainviewer.com/";
const RAINVIEWER_TILE_ZOOM = 7;
const RAINVIEWER_TILE_SIZE: 256 | 512 = 512;
const RAINVIEWER_COLOR_SCHEME = 2;
const RAINVIEWER_TILE_OPTIONS = "1_1";

const NASA_GIBS_WMS_URL = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";
const NASA_GIBS_SOURCE_URL =
  "https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api";
const NASA_GIBS_LAYER = "VIIRS_SNPP_CorrectedReflectance_TrueColor";
const NASA_GIBS_IMAGE_SIZE = 512;
const NASA_GIBS_LOOKBACK_DAYS = 1;
const SATELLITE_LAT_RADIUS_DEG = 2.2;

type SupplementalLocation = LocationInfo & {
  latitude: number;
  longitude: number;
};

type RainViewerFrame = {
  time?: number;
  path?: string;
};

type RainViewerWeatherMaps = {
  generated?: number;
  host?: string;
  radar?: {
    past?: RainViewerFrame[];
    nowcast?: RainViewerFrame[];
  };
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const roundCoordinate = (value: number) => Math.round(value * 10_000) / 10_000;

const formatIsoFromUnixSeconds = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const parsed = new Date(value * 1000);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const formatDateOnly = (date: Date) => date.toISOString().slice(0, 10);

export const resolveGibsSnapshotDate = (now = new Date()) =>
  formatDateOnly(new Date(now.getTime() - NASA_GIBS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000));

export const latLonToTile = (latitude: number, longitude: number, zoom: number) => {
  const lat = clamp(latitude, -85.05112878, 85.05112878);
  const lon = ((((longitude + 180) % 360) + 360) % 360) - 180;
  const latRad = (lat * Math.PI) / 180;
  const scale = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * scale);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale);

  return {
    x: clamp(x, 0, scale - 1),
    y: clamp(y, 0, scale - 1),
  };
};

export const buildRainViewerTileUrl = ({
  host,
  path,
  latitude,
  longitude,
  zoom = RAINVIEWER_TILE_ZOOM,
  size = RAINVIEWER_TILE_SIZE,
  colorScheme = RAINVIEWER_COLOR_SCHEME,
  options = RAINVIEWER_TILE_OPTIONS,
}: {
  host: string;
  path: string;
  latitude: number;
  longitude: number;
  zoom?: number;
  size?: 256 | 512;
  colorScheme?: number;
  options?: string;
}) => {
  const tile = latLonToTile(latitude, longitude, zoom);
  const normalizedHost = host.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return {
    tile,
    url: `${normalizedHost}${normalizedPath}/${size}/${zoom}/${tile.x}/${tile.y}/${colorScheme}/${options}.png`,
  };
};

export const selectLatestRainViewerFrame = (payload: RainViewerWeatherMaps): RainViewerFrame | null => {
  const frames = [...(payload.radar?.past ?? []), ...(payload.radar?.nowcast ?? [])].filter(
    (frame): frame is Required<RainViewerFrame> =>
      typeof frame.time === "number" && Number.isFinite(frame.time) && typeof frame.path === "string" && frame.path.length > 0,
  );

  return frames.sort((left, right) => right.time - left.time)[0] ?? null;
};

const buildSatelliteBbox = (latitude: number, longitude: number): SatelliteSnapshotFrame["bbox"] => {
  const latRadius = SATELLITE_LAT_RADIUS_DEG;
  const cosLat = Math.max(Math.cos((latitude * Math.PI) / 180), 0.28);
  const lonRadius = Math.min(7.5, latRadius / cosLat);
  const west = clamp(longitude - lonRadius, -180, 180);
  const east = clamp(longitude + lonRadius, -180, 180);
  const south = clamp(latitude - latRadius, -90, 90);
  const north = clamp(latitude + latRadius, -90, 90);

  return {
    west: roundCoordinate(west),
    south: roundCoordinate(south),
    east: roundCoordinate(east),
    north: roundCoordinate(north),
  };
};

export const buildGibsWmsUrl = ({
  latitude,
  longitude,
  date = resolveGibsSnapshotDate(),
  width = NASA_GIBS_IMAGE_SIZE,
  height = NASA_GIBS_IMAGE_SIZE,
}: {
  latitude: number;
  longitude: number;
  date?: string;
  width?: number;
  height?: number;
}) => {
  const bbox = buildSatelliteBbox(latitude, longitude);
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: NASA_GIBS_LAYER,
    STYLES: "",
    FORMAT: "image/jpeg",
    TRANSPARENT: "false",
    SRS: "EPSG:4326",
    BBOX: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    WIDTH: String(width),
    HEIGHT: String(height),
    TIME: date,
  });

  return {
    bbox,
    url: `${NASA_GIBS_WMS_URL}?${params.toString()}`,
  };
};

const buildGibsViewerUrl = (bbox: SatelliteSnapshotFrame["bbox"], date: string) => {
  const params = new URLSearchParams({
    v: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    t: date,
  });
  return `https://worldview.earthdata.nasa.gov/?${params.toString()}`;
};

const buildSatelliteSnapshot = (location: SupplementalLocation): SatelliteSnapshotFrame => {
  const date = resolveGibsSnapshotDate();
  const { bbox, url } = buildGibsWmsUrl({
    latitude: location.latitude,
    longitude: location.longitude,
    date,
  });

  return {
    provider: "NASA GIBS",
    layer: NASA_GIBS_LAYER,
    date,
    imageUrl: url,
    sourceUrl: NASA_GIBS_SOURCE_URL,
    viewerUrl: buildGibsViewerUrl(bbox, date),
    latitude: location.latitude,
    longitude: location.longitude,
    bbox,
    width: NASA_GIBS_IMAGE_SIZE,
    height: NASA_GIBS_IMAGE_SIZE,
    statusLabelZh: "全球卫星快照",
    interpretationZh: "这张真彩色卫星图用来看机场附近云带、对流云团和日照遮挡；云越厚、范围越广，通常越不利于白天升温。",
  };
};

const buildRadarSnapshot = async (location: SupplementalLocation): Promise<RadarSnapshotFrame | null> => {
  const payload = await fetchJson<RainViewerWeatherMaps>(RAINVIEWER_API_URL);
  const latestFrame = selectLatestRainViewerFrame(payload);

  if (!payload.host || !latestFrame?.path || typeof latestFrame.time !== "number") {
    return null;
  }

  const { tile, url } = buildRainViewerTileUrl({
    host: payload.host,
    path: latestFrame.path,
    latitude: location.latitude,
    longitude: location.longitude,
  });

  return {
    provider: "RainViewer",
    frameTime: new Date(latestFrame.time * 1000).toISOString(),
    generatedAt: formatIsoFromUnixSeconds(payload.generated),
    tileUrl: url,
    sourceUrl: RAINVIEWER_SOURCE_URL,
    viewerUrl: RAINVIEWER_VIEWER_URL,
    latitude: location.latitude,
    longitude: location.longitude,
    zoom: RAINVIEWER_TILE_ZOOM,
    x: tile.x,
    y: tile.y,
    size: RAINVIEWER_TILE_SIZE,
    colorScheme: RAINVIEWER_COLOR_SCHEME,
    options: RAINVIEWER_TILE_OPTIONS,
    signal: "frame_available",
    statusLabelZh: "雷达帧已读取",
    interpretationZh: "如果机场附近出现彩色回波，说明有降水或对流接近，通常会压低日照和升温空间；空白则更偏向“暂未见近场降水信号”。",
  };
};

const buildSourceStatuses = ({
  radar,
  satellite,
  fetchedAt,
  freshness,
}: {
  radar: RadarSnapshotFrame | null;
  satellite: SatelliteSnapshotFrame | null;
  fetchedAt: string;
  freshness: DataFreshnessState;
}): SupplementalSourceStatus[] => [
  {
    key: "rainviewer-radar",
    label: "雷达快照",
    provider: "RainViewer",
    website: "rainviewer.com",
    status: "production",
    runtimeStatus: radar ? "ready" : "unavailable",
    freshness: radar ? freshness : null,
    hasRuntimeData: Boolean(radar),
    observedAt: radar?.frameTime ?? null,
    readAt: radar ? fetchedAt : null,
    sourceUrl: radar?.sourceUrl ?? RAINVIEWER_SOURCE_URL,
    detail: "免 key 公开雷达帧，用作近场降水/对流旁路证据；不替代主预测，也不从图片反推精确雨量。",
    runtimeNote: radar
      ? `最新雷达帧 ${radar.frameTime}；tile z${radar.zoom}/${radar.x}/${radar.y}`
      : "RainViewer 暂未返回可用 radar frame，首页会只保留卫星增强。",
  },
  {
    key: "nasa-gibs-satellite",
    label: "卫星云图",
    provider: "NASA GIBS",
    website: "earthdata.nasa.gov",
    status: "production",
    runtimeStatus: satellite ? "ready" : "unavailable",
    freshness: satellite ? freshness : null,
    hasRuntimeData: Boolean(satellite),
    observedAt: satellite?.date ?? null,
    readAt: satellite ? fetchedAt : null,
    sourceUrl: satellite?.sourceUrl ?? NASA_GIBS_SOURCE_URL,
    detail: "全球 GIBS 真彩色卫星快照，覆盖所有项目城市，用来判断云带和日照遮挡背景。",
    runtimeNote: satellite
      ? `图层 ${satellite.layer}；范围 ${satellite.bbox.west},${satellite.bbox.south},${satellite.bbox.east},${satellite.bbox.north}`
      : "暂未生成卫星快照 URL。",
  },
];

const buildInterpretation = ({
  radar,
  satellite,
}: {
  radar: RadarSnapshotFrame | null;
  satellite: SatelliteSnapshotFrame | null;
}): SupplementalEvidenceSnapshot["interpretation"] => {
  if (radar && satellite) {
    return {
      headlineZh: "雷达看降水接近，卫星看云带遮光",
      radarSignalZh: radar.interpretationZh,
      satelliteSignalZh: satellite.interpretationZh,
      temperatureImpactTone: "mixed",
      notes: [
        "这是所有城市统一可用的旁路证据，不替换 Meteoblue 主预测和机场 METAR/TAF。",
        "RainViewer 可能存在区域雷达覆盖差异；如果 tile 空白，要结合卫星云图和 METAR/TAF 判断。",
        "NASA GIBS 真彩色图通常有近实时延迟，所以更适合看云系背景，不适合当分钟级实况。",
      ],
    };
  }

  if (satellite) {
    return {
      headlineZh: "雷达暂缺，先用全球卫星看云量背景",
      radarSignalZh: "RainViewer 暂未返回可用雷达帧；不把缺帧误判成无雨。",
      satelliteSignalZh: satellite.interpretationZh,
      temperatureImpactTone: "unknown",
      notes: [
        "卫星图能覆盖所有城市，适合判断大范围云带是否压住日照。",
        "缺少雷达时，降水接近信号需要继续看 METAR/TAF 的天气现象代码。",
      ],
    };
  }

  return {
    headlineZh: "增强证据暂不可用，主预测链保持不受影响",
    radarSignalZh: "暂无雷达帧。",
    satelliteSignalZh: "暂无卫星快照。",
    temperatureImpactTone: "unknown",
    notes: ["旁路源失败时不影响 hourly/report/METAR/TAF/multimodel 的 dashboard 返回。"],
  };
};

export const buildEmptySupplementalEvidence = (
  location: SupplementalLocation,
  warning = "Supplemental evidence is unavailable.",
): SupplementalEvidenceSnapshot => {
  const fetchedAt = new Date().toISOString();
  const satellite = buildSatelliteSnapshot(location);

  return {
    location: {
      id: location.id,
      name: location.name,
      timezone: location.timezone,
    },
    fetchedAt,
    stale: false,
    freshness: "fresh",
    cacheHit: false,
    radar: null,
    satellite,
    sourceStatuses: buildSourceStatuses({
      radar: null,
      satellite,
      fetchedAt,
      freshness: "fresh",
    }),
    interpretation: buildInterpretation({ radar: null, satellite }),
    warnings: [warning],
  };
};

export const applySupplementalRuntimeState = (
  snapshot: SupplementalEvidenceSnapshot,
  runtime: {
    stale: boolean;
    freshness: DataFreshnessState;
    cacheHit: boolean;
  },
): SupplementalEvidenceSnapshot => ({
  ...snapshot,
  stale: runtime.stale,
  freshness: runtime.freshness,
  cacheHit: runtime.cacheHit,
  sourceStatuses: snapshot.sourceStatuses.map((source) => ({
    ...source,
    freshness: source.hasRuntimeData ? runtime.freshness : source.freshness,
  })),
});

export const fetchSupplementalEvidence = async (
  location: SupplementalLocation,
): Promise<SupplementalEvidenceSnapshot> => {
  const fetchedAt = new Date().toISOString();
  const warnings: string[] = [];
  const satellite = buildSatelliteSnapshot(location);
  let radar: RadarSnapshotFrame | null = null;

  try {
    radar = await buildRadarSnapshot(location);
    if (!radar) {
      warnings.push("RainViewer did not return a usable radar frame.");
    }
  } catch (error) {
    warnings.push(`RainViewer radar unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    location: {
      id: location.id,
      name: location.name,
      timezone: location.timezone,
    },
    fetchedAt,
    stale: false,
    freshness: "fresh",
    cacheHit: false,
    radar,
    satellite,
    sourceStatuses: buildSourceStatuses({
      radar,
      satellite,
      fetchedAt,
      freshness: "fresh",
    }),
    interpretation: buildInterpretation({ radar, satellite }),
    warnings,
  };
};
