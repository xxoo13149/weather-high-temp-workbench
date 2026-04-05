import { DEFAULT_LOCATION, LOCATION_REGISTRY } from "../../config.js";
import type { LocationInfo } from "../../domain/weather.js";

export const resolveLocation = (locationId: LocationInfo["id"] = DEFAULT_LOCATION) => {
  const location = LOCATION_REGISTRY[locationId];
  if (!location) {
    return LOCATION_REGISTRY[DEFAULT_LOCATION];
  }

  return location;
};

export const defaultLocation = resolveLocation();
