const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

export const CONFIG = {
  api: {
    BASE_URL: normalizeBaseUrl(env.VITE_WEATHER_API_BASE_URL ?? "/api/weather"),
    USER_BASE_URL: normalizeBaseUrl(env.VITE_USER_API_BASE_URL ?? "/api/user"),
    SYSTEM_BASE_URL: normalizeBaseUrl(env.VITE_SYSTEM_API_BASE_URL ?? "/api/system"),
    DASHBOARD: "/dashboard",
    HOURLY: "/hourly",
    REPORT: "/report",
    MULTIMODEL_IMAGE: "/multimodel/image",
    MULTIMODEL_STATUS: "/multimodel/status",
    MULTIMODEL_DISTRIBUTION: "/multimodel/distribution",
    MULTIMODEL_INSIGHTS: "/multimodel/insights",
    KELLY: "/kelly",
    KELLY_STREAM: "/kelly/stream",
    FAVORITES: "/favorites",
    SYSTEM_STATUS: "/status",
  },
  location: {
    DEFAULT_ID: "shanghai_pvg",
    DEFAULT_NAME: "上海浦东国际机场",
    DEFAULT_LABEL: "上海浦东国际机场",
  },
  refresh: {
    DASHBOARD_POLL_INTERVAL_MS: 60_000,
    MIN_VISIBLE_PENDING_MS: 250,
    SUCCESS_FEEDBACK_MS: 1200,
    ERROR_FEEDBACK_MS: 1800,
  },
  text: {
    statusMapping: {
      fresh: "最新",
      stale: "缓存",
      ready: "可用",
      revalidating: "后台刷新中",
      fallback_error: "缓存回退",
      synced: "已同步",
      unavailable: "不可用",
    } as Record<string, string>,
    predictabilityMapping: {
      very_high: "很高",
      high: "较高",
      medium: "中等",
      low: "偏低",
    } as Record<string, string>,
    warningMapping: {
      "1h table not found.": "未找到 1 小时源站表，当前可能需要回退到 meteogram 数据。",
      "1h table exists but contains no time columns.": "1 小时源站表存在，但没有解析到时间列。",
      "Background refresh is in progress; showing the most recent cached week page data.": "后台正在刷新小时与报告数据，当前先展示最近一次成功抓取的缓存。",
      "Serving stale week page data because the latest refresh failed.": "小时数据刷新失败，当前展示的是最近一次成功抓取的缓存。",
      "Weather report heading block not found, used text fallback extraction.": "天气报告区块结构发生变化，已切换到文本兜底解析。",
      "Weather report translation fallback applied.": "中文天气摘要使用了后端兜底翻译。",
      "The parsed 1h view did not expose a full 24-hour window; returned the available hours.": "源站 1 小时视图未完整提供 24 小时窗口，当前已返回可读取到的全部小时数据。",
      "1h data fell back to embedded meteogram because the 1h table could not be parsed.": "1 小时表格暂时无法解析，当前已回退到 meteogram 小时数据。",
      "Background refresh is in progress; showing the most recent cached multimodel statistics.": "后台正在刷新多模型统计，当前先展示最近一次成功抓取的缓存。",
      "Serving stale page-derived multimodel statistics because the latest highcharts refresh failed.": "多模型统计刷新失败，当前展示的是最近一次成功抓取的缓存。",
      "Background refresh is in progress; showing the most recent cached multimodel insights.": "后台正在刷新多模型洞察，当前先展示最近一次成功抓取的缓存。",
      "Serving stale page-derived multimodel insights because the latest highcharts refresh failed.": "多模型洞察刷新失败，当前展示的是最近一次成功抓取的缓存。",
      "actualTemperatureC was not provided; using selected timestamp model mean as realtime assumption.": "未传入参考温度，当前使用该时刻模型均温作为临时参考。",
      "No timestamp query was provided; selected the nearest timestamp to the current server time.": "未指定时刻，系统已自动选取最接近当前时间的模型时刻。",
      "Requested timestamp was unavailable; selected the nearest available timestamp from the chart.": "指定的模型时刻不可用，系统已自动回退到最近的可用时刻。",
      "Could not resolve nearest-now timestamp; selected the first available timestamp from the chart.": "未能定位最接近当前时间的模型时刻，系统已回退到图表中的首个可用时刻。",
    } as Record<string, string>,
  },
  fallback: {
    emptyText: "暂无可用天气摘要",
    imageError: "官方原图暂时读取失败",
    distributionError: "模型洞察暂时读取失败",
    nullValue: "--",
  },
};
