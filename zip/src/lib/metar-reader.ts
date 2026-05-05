const ICAO_STATION_CODE_PATTERN = /^[A-Z]{4}$/;

export const buildMetarReaderUrl = (stationCode: string | null | undefined) => {
  const normalized = stationCode?.trim().toUpperCase();
  if (!normalized || !ICAO_STATION_CODE_PATTERN.test(normalized)) {
    return null;
  }

  return `https://www.metarreader.com/${encodeURIComponent(normalized)}`;
};
