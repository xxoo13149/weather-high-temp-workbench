import { Globe2, MapPinned, Pin, Star, X } from "lucide-react";
import { useMemo, useRef } from "react";

import type { DockLocation, DockLocationGroup } from "../types";
import { valueOrDash } from "../utils";

const RAIL_TEXT = {
  ariaLabel: "地点侧栏",
  closeRail: "关闭地点侧栏",
  currentTemperature: "当前温度",
  favorite: "收藏",
  unfavorite: "取消收藏",
} as const;

const groupShortLabel: Record<DockLocation["timezoneGroup"], string> = {
  asia: "亚",
  europe: "欧",
  americas: "美",
};

const groupLongLabel: Record<DockLocation["timezoneGroup"], string> = {
  asia: "亚洲",
  europe: "欧洲",
  americas: "美洲",
};

const groupDescription: Record<DockLocation["timezoneGroup"], string> = {
  asia: "东亚与东南亚的高温交易地点。",
  europe: "欧洲白天时段常看的重点站点。",
  americas: "北美与南美盘口常看的城市。",
};

const renderCollapsedLocation = ({
  location,
  pendingId,
  onSelect,
}: {
  location: DockLocation;
  pendingId: string | null;
  onSelect: (id: string) => void;
}) => {
  const isPending = pendingId === location.id;

  return (
    <button
      key={location.id}
      type="button"
      onClick={() => onSelect(location.id)}
      aria-current={location.isActive ? "true" : "false"}
      className={`group relative mx-auto flex h-[3.75rem] w-[3.75rem] items-center justify-center rounded-[20px] border px-0 py-0 text-left transition location-card ${
        location.isActive ? "location-card-active" : "location-card-default"
      } ${location.isFavorite ? "location-card-favorite" : ""} ${isPending ? "border-[rgba(107,231,255,0.38)]" : ""}`}
      data-pending={isPending ? "true" : "false"}
    >
      <div className="relative">
        <span className="text-sm font-semibold">{location.shortLabel}</span>
        {location.isActive ? <span className="absolute -right-2 -top-2 h-2.5 w-2.5 rounded-full bg-[var(--accent)]" /> : null}
        {isPending ? <span className="absolute -left-2 -top-2 h-2.5 w-2.5 animate-pulse rounded-full bg-[rgba(107,231,255,0.92)]" /> : null}
        {location.isFavorite ? <Star className="absolute -bottom-2 -right-2 h-3.5 w-3.5 fill-[var(--warning)] text-[var(--warning)]" /> : null}
      </div>
    </button>
  );
};

const renderExpandedLocation = ({
  location,
  favoritePendingIds,
  pendingId,
  onSelect,
  onToggleFavorite,
}: {
  location: DockLocation;
  favoritePendingIds: string[];
  pendingId: string | null;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}) => {
  const favoritePending = favoritePendingIds.includes(location.id);
  const isPending = pendingId === location.id;

  return (
    <div
      key={location.id}
      role="button"
      tabIndex={0}
      aria-current={location.isActive ? "true" : "false"}
      className={`group relative rounded-[24px] border px-4 py-4 text-left transition location-card ${
        location.isActive ? "location-card-active" : "location-card-default"
      } ${location.isFavorite ? "location-card-favorite" : ""} ${isPending ? "border-[rgba(107,231,255,0.32)] shadow-[0_0_0_1px_rgba(107,231,255,0.14)]" : ""}`}
      data-pending={isPending ? "true" : "false"}
      onClick={() => onSelect(location.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(location.id);
        }
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-white/44">
            {location.isActive ? <Pin className="h-3 w-3 text-[var(--accent)]" /> : null}
            <span>{location.code}</span>
            {isPending ? (
              <span className="rounded-full border border-[rgba(107,231,255,0.22)] bg-[rgba(107,231,255,0.1)] px-2 py-0.5 text-[10px] tracking-[0.16em] text-[rgba(182,244,255,0.92)]">
                切换中
              </span>
            ) : null}
          </div>
          <div className="mt-3 line-clamp-2 text-base font-semibold leading-6 text-white">{location.displayName}</div>
          <div className="mt-1 text-sm leading-6 text-white/54">{location.displayNameZh}</div>
          <div className="mt-1 text-xs leading-5 text-white/40">
            {location.cityName} / {location.countryName}
          </div>
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(location.id);
          }}
          disabled={favoritePending}
          aria-label={location.isFavorite ? RAIL_TEXT.unfavorite : RAIL_TEXT.favorite}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/20 transition hover:border-white/18"
        >
          <Star className={`h-4 w-4 ${location.isFavorite ? "fill-[var(--warning)] text-[var(--warning)]" : "text-white/52"}`} />
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <span className="text-xs text-white/48">{RAIL_TEXT.currentTemperature}</span>
        <span className="data-mono text-lg font-semibold text-white">{valueOrDash(location.temp, "°C")}</span>
      </div>
    </div>
  );
};

export const LocationRail = ({
  expanded,
  activeId,
  pendingId,
  activeGroup,
  groups,
  onGroupChange,
  onSelect,
  onToggleFavorite,
  favoritePendingIds,
  error,
  onDismiss,
}: {
  expanded: boolean;
  activeId: string;
  pendingId: string | null;
  activeGroup: DockLocation["timezoneGroup"];
  groups: DockLocationGroup[];
  onGroupChange: (group: DockLocation["timezoneGroup"]) => void;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  favoritePendingIds: string[];
  error: string | null;
  onDismiss: () => void;
}) => {
  const currentGroupItems = useMemo(
    () => groups.find((group) => group.group === activeGroup)?.items ?? [],
    [activeGroup, groups],
  );
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<DockLocation["timezoneGroup"], HTMLElement | null>>({
    asia: null,
    europe: null,
    americas: null,
  });

  if (expanded) {
    return (
      <aside className="location-rail location-rail-expanded" aria-label={RAIL_TEXT.ariaLabel} data-expanded="true">
        <button type="button" aria-label={RAIL_TEXT.closeRail} className="location-rail-backdrop" onClick={onDismiss} />
        <div className="location-rail-canvas terminal-panel">
          <div className="panel-section location-rail-canvas-inner">
            <div className="location-rail-canvas-header">
              <div>
                <div className="eyebrow flex items-center gap-2">
                  <MapPinned className="h-4 w-4 text-[var(--accent)]" />
                  地点画布
                </div>
                <h2 className="location-rail-canvas-title">三组同屏，直接切地点</h2>
                <p className="location-rail-canvas-copy">
                  亚洲、欧洲、美洲同时展开。顶部导航只负责定位和高亮，不再隐藏其他分组。
                </p>
              </div>

              <button
                type="button"
                className="location-rail-close-button"
                onClick={onDismiss}
                aria-label={RAIL_TEXT.closeRail}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="location-rail-canvas-nav">
              {groups.map((group) => {
                const active = group.group === activeGroup;
                return (
                  <button
                    key={group.group}
                    type="button"
                    onClick={() => {
                      onGroupChange(group.group);
                      const container = scrollContainerRef.current;
                      const section = sectionRefs.current[group.group];
                      if (!container || !section) {
                        return;
                      }

                      container.scrollTo({
                        top: Math.max(0, section.offsetTop - container.offsetTop),
                        behavior: "smooth",
                      });
                    }}
                    className={`location-rail-canvas-nav-button ${active ? "is-active" : ""}`}
                    aria-pressed={active}
                  >
                    <span className="location-rail-canvas-nav-label">{groupLongLabel[group.group]}</span>
                    <span className="location-rail-canvas-nav-meta">{group.items.length} 个地点</span>
                  </button>
                );
              })}
            </div>

            <div ref={scrollContainerRef} className="location-rail-canvas-scroll scrollbar-terminal">
              {groups.map((group) => (
                <section
                  key={group.group}
                  ref={(node) => {
                    sectionRefs.current[group.group] = node;
                  }}
                  className={`location-rail-section ${group.group === activeGroup ? "is-focus" : ""}`}
                >
                  <div className="location-rail-section-head">
                    <div className="location-rail-section-copy">
                      <div className="eyebrow">{groupLongLabel[group.group]}</div>
                      <h3>{groupLongLabel[group.group]}</h3>
                      <p>{groupDescription[group.group]}</p>
                    </div>
                    <div className="location-rail-section-meta">{group.items.length} 个地点</div>
                  </div>

                  <div className="location-rail-location-grid">
                    {group.items.map((location) =>
                      renderExpandedLocation({
                        location,
                        favoritePendingIds,
                        pendingId,
                        onSelect,
                        onToggleFavorite,
                      }),
                    )}
                  </div>
                </section>
              ))}
            </div>

            {error ? <div className="location-rail-error">{error}</div> : null}
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="terminal-panel location-rail shrink-0 overflow-hidden"
      aria-label={RAIL_TEXT.ariaLabel}
      data-expanded="false"
    >
      <div className="panel-section location-rail-shell flex h-full min-h-0 flex-col gap-3 px-3 py-4">
        <div className="flex items-center justify-center text-white/62">
          <Globe2 className="h-4 w-4 text-[var(--accent)]" />
        </div>

        <div className="location-rail-group-switcher flex flex-col items-center gap-2">
          {groups.map((group) => {
            const active = group.group === activeGroup;
            return (
              <button
                key={group.group}
                type="button"
                onClick={() => onGroupChange(group.group)}
                className={`location-rail-group-button inline-flex h-12 w-12 items-center justify-center rounded-[18px] border text-sm font-medium transition ${
                  active ? "location-rail-group-button-active" : ""
                }`}
                aria-pressed={active}
                aria-label={group.label || groupLongLabel[group.group]}
                title={group.label || groupLongLabel[group.group]}
              >
                {groupShortLabel[group.group]}
              </button>
            );
          })}
        </div>

        <div className="scrollbar-terminal flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
          {currentGroupItems.map((location) =>
            renderCollapsedLocation({
              location: {
                ...location,
                isActive: location.id === activeId,
              },
              pendingId,
              onSelect,
            }),
          )}
        </div>
      </div>
    </aside>
  );
};
