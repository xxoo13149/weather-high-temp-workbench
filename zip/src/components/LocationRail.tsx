import { Globe2, Pin, Star } from "lucide-react";
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
    } ${location.isFavorite ? "location-card-favorite" : ""} mx-auto flex h-14 w-14 items-center justify-center px-0 py-0`}
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
      className={`group relative rounded-[20px] border px-3.5 py-3.5 text-left transition location-card ${
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-white/42">
            {location.isActive ? <Pin className="h-3 w-3 text-[var(--accent)]" /> : null}
            {location.code}
          </div>
          <div className="mt-2 line-clamp-2 text-sm font-semibold leading-6">{location.displayName}</div>
          <div className="mt-1 text-xs leading-5 text-white/48">{location.displayNameZh}</div>
          <div className="mt-1 text-[11px] leading-5 text-white/38">{location.cityName} · {location.countryName}</div>
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(location.id);
          }}
          disabled={favoritePending}
          aria-label={location.isFavorite ? UI_TEXT.rail.unfavorite : UI_TEXT.rail.favorite}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/20 transition hover:border-white/18"
        >
          <Star className={`h-4 w-4 ${location.isFavorite ? "fill-[var(--warning)] text-[var(--warning)]" : "text-white/52"}`} />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-white/46">{UI_TEXT.rail.currentTemperature}</span>
        <span className="data-mono text-base font-semibold text-white">{valueOrDash(location.temp, "°C")}</span>
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

    sectionRefs.current[activeGroup]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeGroup, expanded]);

  return (
    <aside
      className={`terminal-panel location-rail shrink-0 overflow-hidden transition-[width,transform,opacity] duration-300 ${
        expanded ? "w-[336px]" : "w-[96px]"
      }`}
      aria-label={UI_TEXT.rail.ariaLabel}
    >
      <div className="panel-section location-rail-shell flex h-full min-h-0 flex-col gap-3 px-3 py-4">
        <div className={`flex items-center ${expanded ? "justify-between" : "justify-center"} text-white/62`}>
          {expanded ? (
            <>
              <div>
                <div className="eyebrow">{UI_TEXT.rail.title}</div>
                <div className="mt-2 text-xs text-white/56">{UI_TEXT.rail.description}</div>
              </div>
              <Globe2 className="h-4 w-4 text-[var(--accent)]" />
            </>
          ) : (
            <Globe2 className="h-4 w-4 text-[var(--accent)]" />
          )}
        </div>

        <div
          className={`location-rail-group-switcher ${
            expanded ? "location-rail-group-switcher-expanded flex gap-2" : "flex flex-col items-center gap-2"
          }`}
        >
          {groups.map((group) => {
            const active = group.group === activeGroup;
            return (
              <button
                key={group.group}
                type="button"
                onClick={() => onGroupChange(group.group)}
                className={`location-rail-group-button inline-flex items-center justify-center rounded-[18px] border text-sm font-medium transition ${active ? "location-rail-group-button-active" : ""} ${expanded ? "min-h-[48px] flex-1 px-3" : "h-11 w-11"}`}
                aria-pressed={active}
                aria-label={group.label || groupLongLabel[group.group]}
                title={group.label || groupLongLabel[group.group]}
              >
                <span className="flex items-center gap-2">
                  <span>{expanded ? groupLongLabel[group.group] : groupShortLabel[group.group]}</span>
                  {expanded ? <span className="text-[11px] text-white/44">{group.items.length}</span> : null}
                </span>
              </button>
            );
          })}
        </div>

        <div className="scrollbar-terminal flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
          {expanded
            ? groups.map((group) => (
                <section
                  key={group.group}
                  ref={(node) => {
                    sectionRefs.current[group.group] = node;
                  }}
                  className={`rounded-[22px] border px-3 py-3 transition ${
                    group.group === activeGroup
                      ? "border-[rgba(255,255,255,0.14)] bg-white/[0.04]"
                      : "border-white/8 bg-white/[0.02]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{groupLongLabel[group.group]}</div>
                      <div className="mt-1 text-[11px] text-white/44">{group.items.length} 个地点</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onGroupChange(group.group)}
                      className={`rounded-full border px-3 py-1 text-[11px] transition ${
                        group.group === activeGroup
                          ? "border-[var(--border-strong)] bg-white/[0.06] text-white"
                          : "border-white/10 bg-black/20 text-white/56 hover:border-white/18 hover:text-white/76"
                      }`}
                    >
                      {group.group === activeGroup ? "当前组" : "定位"}
                    </button>
                  </div>
                  <div className="mt-3 space-y-3">
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
              ))
            : currentGroupItems.map((location) =>
                renderCollapsedLocation({
                  location: {
                    ...location,
                    isActive: location.id === activeId,
                  },
                  onSelect,
                }),
              )}
        </div>

        {expanded && error ? (
          <div className="rounded-[18px] border border-[rgba(242,183,109,0.18)] bg-[rgba(242,183,109,0.08)] px-3 py-2 text-xs leading-5 text-[#ffe5c0]">
            {error}
          </div>
        ) : null}
      </div>
    </aside>
  );
};
