export const HOME_DETAIL_ID = {
  referenceDetails: "reference-details",
  aviationModal: "aviation-modal",
  hourDetailModal: "hour-detail-modal",
} as const;

export const HOME_DETAIL_TRIGGER_KIND = {
  metar: "metar",
  taf: "taf",
} as const;

export const HOME_DETAIL_SLOT = {
  summary: "summary",
  sourceList: "source-list",
  rawSource: "raw-source",
  changeList: "change-list",
  timelineDetail: "timeline-detail",
  evidence: "evidence",
} as const;

export const HOME_DETAIL_SOURCE = {
  referenceSummary: "reference-summary",
  referenceRow: "reference-row",
  hourSummary: "hour-summary",
  hourInspector: "hour-inspector",
  metarSummary: "metar-summary",
  tafSummary: "taf-summary",
} as const;

export type HomeDetailId = (typeof HOME_DETAIL_ID)[keyof typeof HOME_DETAIL_ID];
export type HomeDetailTriggerKind = (typeof HOME_DETAIL_TRIGGER_KIND)[keyof typeof HOME_DETAIL_TRIGGER_KIND];
export type HomeDetailSlot = (typeof HOME_DETAIL_SLOT)[keyof typeof HOME_DETAIL_SLOT];
export type HomeDetailSource = (typeof HOME_DETAIL_SOURCE)[keyof typeof HOME_DETAIL_SOURCE];
