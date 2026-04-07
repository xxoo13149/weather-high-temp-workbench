import { Globe2, MapPinned, Pin, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { UI_TEXT } from "../display-text";
import type { DockLocation, DockLocationGroup } from "../types";
import { valueOrDash } from "../utils";

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
  europe: "欧洲工作时段常看的重点站点。",
  americas: "北美与美洲盘口常看的城市。",
};

const renderCollapsedLocation = ({
  location,
  onSelect,
}: {
  location: DockLocation;
  onSelect: (id: string) => void;
}) => (
  <button
    key={location.id}
    type="button"
    onClick={() => onSelect(location.id)}
    aria-current={location.isActive ? "true" : "false"}
    className={`group relative rounded-[20px] border text-left transition location-card ${
      location.isActive ? "location-card-active" : "location-card-default"
    } ${location.isFavorite ? "location-card-favorite" : ""} mx-auto flex h-[3.75rem] w-[3.75rem] items-center justify-center px-0 py-0`}
  >
    <div className="relative">
      <span className="text-sm font-semibold">{location.shortLabel}</span>
      {location.isActive ? <span className="absolute -right-2 -top-2 h-2.5 w-2.5 rounded-full bg-[var(--accent)]" /> : null}
      {location.isFavorite ? <Star className="absolute -bottom-2 -right-2 h-3.5 w-3.5 fill-[var(--warning)] text-[var(--warning)]" /> : null}
    </div>
  </button>
);

const renderExpandedLocation = ({
  location,
  favoritePendingIds,
  onSelect,
  onToggleFavorite,
}: {
  location: DockLocation;
  favoritePendingIds: string[];
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}) => {
  const favoritePending = favoritePendingIds.includes(location.id);

  return (
    <div
      key={location.id}
      role="button"
      tabIndex={0}
      aria-current={location.isActive ? "true" : "false"}
      className={`group relative rounded-[24px] border px-4 py-4 text-left transition location-card ${
        location.isActive ? "location-card-active" : "location-card-default"
      } ${location.isFavorite ? "location-card-favorite" : ""}`}
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
          aria-label={location.isFavorite ? UI_TEXT.rail.unfavorite : UI_TEXT.rail.favorite}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/20 transition hover:border-white/18"
        >
          <Star className={`h-4 w-4 ${location.isFavorite ? "fill-[var(--warning)] text-[var(--warning)]" : "text-white/52"}`} />
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <span className="text-xs text-white/48">{UI_TEXT.rail.currentTemperature}</span>
        <span className="data-mono text-lg font-semibold text-white">{valueOrDash(location.temp, "°C")}</span>
      </div>
    </div>
  );
};

export const LocationRail = ({
  expanded,
  activeId,
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
  const sectionRefs = useRef<Record<DockLocation["timezoneGroup"], HTMLDivElement | null>>({
    asia: null,
    europe: null,
    americas: null,
  });

  useEffect(() => {
    if (!expanded) {
      return;
    }

    sectionRefs.current[activeGroup]?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
  }, [activeGroup, expanded]);

  if (expanded) {
    return (
      <aside className="location-rail location-rail-expanded" aria-label={UI_TEXT.rail.ariaLabel} data-expanded="true">
        <button type="button" aria-label={UI_TEXT.app.closeRail} className="location-rail-backdrop" onClick={onDismiss} />
        <div className="location-rail-canvas terminal-panel">
          <div className="panel-section location-rail-canvas-inner">
            <div className="location-rail-canvas-header">
              <div>
                <div className="eyebrow flex items-center gap-2">
                  <MapPinned className="h-4 w-4 text-[var(--accent)]" />
                  地点画布
                </div>
                <h2 className="location-rail-canvas-title">三组同屏，直接切地点</h2>
                <p className="location-rail-canvas-copy">亚洲、欧洲、美洲同时展开。顶部导航只负责定位和高亮，不再把其他区域折叠掉。</p>
              </div>

              <button
                type="button"
                className="location-rail-close-button"
                onClick={onDismiss}
                aria-label={UI_TEXT.app.closeRail}
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
                      sectionRefs.current[group.group]?.scrollIntoView({
                        block: "start",
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

            <div className="location-rail-canvas-scroll scrollbar-terminal">
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
                        onSelect,
                        onToggleFavorite,
                      }),
                    )}
                  </div>
                </section>
              ))}
            </div>

            {error ? (
              <div className="location-rail-error">
                {error}
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    );
  }

    return (
      <aside
        className="terminal-panel location-rail shrink-0 overflow-hidden"
        aria-label={UI_TEXT.rail.ariaLabel}
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
              onSelect,
            }),
          )}
        </div>
      </div>
    </aside>
  );
};
