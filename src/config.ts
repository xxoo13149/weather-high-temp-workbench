export type TimezoneGroup = "asia" | "europe" | "americas";

const METEOBLUE_BASE_URL = "https://www.meteoblue.com";
const DEFAULT_LOCATION_ID = "shanghai_pvg";

export interface LocationCatalogEntry {
  id: string;
  code: string;
  displayName: string;
  displayNameZh: string;
  shortLabel: string;
  cityName: string;
  countryName: string;
  timezone: string;
  timezoneGroup: TimezoneGroup;
  latitude: number;
  longitude: number;
  aslM: number;
  meteoblueWeekPath: string;
  enabled: boolean;
  sortOrder: number;
}

const LOCATION_CATALOG = {
  shanghai_pvg: {
    id: "shanghai_pvg",
    code: "PVG",
    displayName: "Shanghai Pudong International Airport",
    displayNameZh: "上海浦东国际机场",
    shortLabel: "PVG",
    cityName: "Shanghai",
    countryName: "China",
    timezone: "Asia/Shanghai",
    timezoneGroup: "asia",
    latitude: 31.1426792,
    longitude: 121.8052144,
    aslM: 2,
    meteoblueWeekPath: "/en/weather/week/shanghai-pudong-international-airport_china_6301386",
    enabled: true,
    sortOrder: 10,
  },
  wuhan_wuh: {
    id: "wuhan_wuh",
    code: "WUH",
    displayName: "Wuhan Tianhe International Airport",
    displayNameZh: "武汉天河国际机场",
    shortLabel: "WUH",
    cityName: "Wuhan",
    countryName: "China",
    timezone: "Asia/Shanghai",
    timezoneGroup: "asia",
    latitude: 30.776598,
    longitude: 114.2137146,
    aslM: 34,
    meteoblueWeekPath: "/en/weather/week/wuhan-tianhe-international-airport_china_6301368",
    enabled: true,
    sortOrder: 20,
  },
  istanbul_ist: {
    id: "istanbul_ist",
    code: "IST",
    displayName: "Istanbul Airport",
    displayNameZh: "伊斯坦布尔机场",
    shortLabel: "IST",
    cityName: "Istanbul",
    countryName: "Republic of Turkiye",
    timezone: "Europe/Istanbul",
    timezoneGroup: "europe",
    latitude: 41.2657398,
    longitude: 28.7420522,
    aslM: 99,
    meteoblueWeekPath: "/en/weather/week/istanbul-airport_republic-of-t%C3%BCrkiye_11838481",
    enabled: true,
    sortOrder: 10,
  },
  munich_muc: {
    id: "munich_muc",
    code: "MUC",
    displayName: "Munich Airport Franz Josef Strauss International Airport",
    displayNameZh: "慕尼黑机场",
    shortLabel: "MUC",
    cityName: "Munich",
    countryName: "Germany",
    timezone: "Europe/Berlin",
    timezoneGroup: "europe",
    latitude: 48.3536623,
    longitude: 11.7750277,
    aslM: 449,
    meteoblueWeekPath:
      "/en/weather/week/munich-airport-franz-josef-strauss-international-airport_germany_3208399",
    enabled: true,
    sortOrder: 20,
  },
  toronto_yyz: {
    id: "toronto_yyz",
    code: "YYZ",
    displayName: "Toronto Pearson International Airport",
    displayNameZh: "多伦多皮尔逊国际机场",
    shortLabel: "YYZ",
    cityName: "Toronto",
    countryName: "Canada",
    timezone: "America/Toronto",
    timezoneGroup: "americas",
    latitude: 43.6776612,
    longitude: -79.6248197,
    aslM: 173,
    meteoblueWeekPath: "/en/weather/week/toronto-pearson-international-airport_canada_6296338",
    enabled: true,
    sortOrder: 10,
  },
  miami_mia: {
    id: "miami_mia",
    code: "MIA",
    displayName: "Miami International Airport",
    displayNameZh: "迈阿密国际机场",
    shortLabel: "MIA",
    cityName: "Miami",
    countryName: "United States",
    timezone: "America/New_York",
    timezoneGroup: "americas",
    latitude: 25.7934494,
    longitude: -80.2905556,
    aslM: 2,
    meteoblueWeekPath: "/en/weather/week/miami-international-airport_united-states_4164181",
    enabled: true,
    sortOrder: 20,
  },
} as const satisfies Record<string, LocationCatalogEntry>;

export type LocationId = keyof typeof LOCATION_CATALOG;
export const TIMEZONE_GROUP_ORDER: TimezoneGroup[] = ["asia", "europe", "americas"];
export const DEFAULT_LOCATION: LocationId = DEFAULT_LOCATION_ID as LocationId;

export interface RegisteredLocation extends Omit<LocationCatalogEntry, "id"> {
  id: LocationId;
  name: string;
  weekPageUrl: string;
  multimodelPageUrl: string;
}

export const buildWeekPageUrl = (entry: LocationCatalogEntry) => `${METEOBLUE_BASE_URL}${entry.meteoblueWeekPath}`;

export const buildMultimodelPageUrl = (entry: LocationCatalogEntry) =>
  `${METEOBLUE_BASE_URL}${entry.meteoblueWeekPath.replace("/weather/week/", "/weather/forecast/multimodel/")}`;

const toRegisteredLocation = <T extends LocationCatalogEntry>(entry: T): RegisteredLocation => ({
  ...entry,
  id: entry.id as LocationId,
  name: entry.displayName,
  weekPageUrl: buildWeekPageUrl(entry),
  multimodelPageUrl: buildMultimodelPageUrl(entry),
});

export const LOCATION_REGISTRY: Record<LocationId, RegisteredLocation> = Object.fromEntries(
  Object.values(LOCATION_CATALOG).map((entry) => [entry.id, toRegisteredLocation(entry)]),
) as Record<LocationId, RegisteredLocation>;

export const LOCATION_DIRECTORY: RegisteredLocation[] = Object.values(LOCATION_REGISTRY)
  .filter((entry) => entry.enabled)
  .sort(
    (left, right) =>
      TIMEZONE_GROUP_ORDER.indexOf(left.timezoneGroup) - TIMEZONE_GROUP_ORDER.indexOf(right.timezoneGroup) ||
      left.sortOrder - right.sortOrder ||
      left.displayName.localeCompare(right.displayName),
  );

const readNumber = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
};

export const config = {
  port: readNumber("PORT", 3000),
  host: process.env.HOST ?? "0.0.0.0",
  weekPageTtlMs: readNumber("WEEK_PAGE_TTL_MS", 90_000),
  multimodelImageTtlMs: readNumber("MULTIMODEL_IMAGE_TTL_MS", 300_000),
  multimodelDistributionTtlMs: readNumber("MULTIMODEL_STATS_TTL_MS", 120_000),
  polymarketMarketTtlMs: readNumber("POLYMARKET_MARKET_TTL_MS", 60_000),
  polymarketOrderbookTtlMs: readNumber("POLYMARKET_ORDERBOOK_TTL_MS", 5_000),
  httpTimeoutMs: readNumber("HTTP_TIMEOUT_MS", 30_000),
  polymarketGammaBaseUrl: process.env.POLYMARKET_GAMMA_BASE_URL ?? "https://gamma-api.polymarket.com",
  polymarketClobBaseUrl: process.env.POLYMARKET_CLOB_BASE_URL ?? "https://clob.polymarket.com",
  polymarketClobWsUrl:
    process.env.POLYMARKET_CLOB_WS_URL ?? "wss://ws-subscriptions-clob.polymarket.com/ws/market",
  userAgent:
    process.env.USER_AGENT ??
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) weather-relay/0.2",
};
