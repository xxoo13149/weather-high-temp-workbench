import type { KellyTemperatureUnit } from "@/types";

export const convertAbsoluteTemperature = (value: number, unit: KellyTemperatureUnit): number =>
  unit === "F" ? (value * 9) / 5 + 32 : value;

export const convertDeltaTemperature = (value: number, unit: KellyTemperatureUnit): number =>
  unit === "F" ? (value * 9) / 5 : value;
