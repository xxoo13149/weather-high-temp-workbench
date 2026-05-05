import { Globe2, MapPinned, Pin, Search, Star, X } from "lucide-react";
import { Fragment, type MutableRefObject, type RefObject, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { DockLocation, DockLocationGroup } from "../types";
import { formatTemperature } from "../utils";

const RAIL_TEXT = {
  ariaLabel: "地点侧栏",
  closeRail: "关闭地点侧栏",
  openRail: "打开城市选择器",
  currentTemperature: "当前温度",
  currentLocation: "当前地点",
  favoritesEmpty: "还没有收藏地点，先从城市卡片里点亮星标。",
  searchPlaceholder: "搜索城市、机场码或中文名",
  searchEmpty: "没有找到匹配的地点",
  searchHint: "试试机场码、英文城市名或中文机场名。",
} as const;

type PickerView = "common" | "favorites" | "group";

const GROUP_SHORT_LABEL: Record<DockLocation["timezoneGroup"], string> = {
  asia: "亚洲",
  europe: "欧洲",
  africa: "非洲",
  americas: "美洲",
  oceania: "大洋",
};

const GROUP_LONG_LABEL: Record<DockLocation["timezoneGroup"], string> = {
  asia: "亚洲",
  europe: "欧洲",
  africa: "非洲",
  americas: "美洲",
  oceania: "大洋洲",
};

const GROUP_DESCRIPTION: Record<DockLocation["timezoneGroup"], string> = {
  asia: "优先查看东亚与东南亚机场，适合高频跟踪。",
  europe: "覆盖欧洲白天时段，便于快速切换跨城样本。",
  africa: "聚焦非洲热点机场，保留少量高信号入口。",
  americas: "美洲盘口密集，先看收藏和当前城市命中率更高。",
  oceania: "跨日区机场更适合单屏浏览和直接搜索。",
};

const resolveGroupShortLabel = (group: DockLocation["timezoneGroup"]) => GROUP_SHORT_LABEL[group];
const resolveGroupLongLabel = (group: DockLocation["timezoneGroup"]) => GROUP_LONG_LABEL[group];
const resolveGroupDescription = (group: DockLocation["timezoneGroup"]) => GROUP_DESCRIPTION[group];

const buildSearchKey = (location: DockLocation) =>
  [
    location.code,
    ...location.stationCodes,
    location.shortLabel,
    location.displayName,
    location.displayNameZh,
    location.cityName,
    location.countryName,
  ]
    .join(" ")
    .toLowerCase();

const ICAO_STATION_CODE_PATTERN = /^[A-Z0-9]{4}$/;

const dedupeLocations = (locations: Array<DockLocation | null | undefined>) => {
  const seen = new Set<string>();
  const result: DockLocation[] = [];

  for (const location of locations) {
    if (!location || seen.has(location.id)) {
      continue;
    }

    seen.add(location.id);
    result.push(location);
  }

  return result;
};

const StatusBadges = ({
  isActive,
  isPending,
  isFavorite,
}: {
  isActive: boolean;
  isPending: boolean;
  isFavorite: boolean;
}) => (
  <div className="location-status-row" aria-hidden="true">
    {isActive ? (
      <span className="location-status-badge is-active">
        <Pin className="h-3 w-3" />
        当前
      </span>
    ) : null}
    {isPending ? <span className="location-status-badge is-pending">切换中</span> : null}
    {isFavorite ? (
      <span className="location-status-badge is-favorite">
        <Star className="h-3 w-3 fill-[currentColor]" />
        收藏
      </span>
    ) : null}
  </div>
);

const QuickLocationCard = ({
  location,
  pendingId,
  onSelect,
}: {
  location: DockLocation;
  pendingId: string | null;
  onSelect: (id: string) => void;
}) => {
  const isPending = pendingId === location.id;
  const isActive = location.isActive;

  return (
    <button
      key={location.id}
      type="button"
      onClick={() => onSelect(location.id)}
      aria-current={isActive ? "true" : "false"}
      aria-label={`${location.code} ${location.displayName}`}
      className={`location-card location-quick-card ${isActive ? "location-card-active" : "location-card-default"} ${
        location.isFavorite ? "location-card-favorite" : ""
      } ${isPending ? "location-card-pending" : ""}`}
      data-pending={isPending ? "true" : "false"}
    >
      <div className="location-quick-card-head">
        <span className="location-code-pill">{location.code}</span>
        <span className="data-mono location-quick-card-temp">
          {formatTemperature(location.temp, location.displayUnit)}
        </span>
      </div>

      <div className="location-quick-card-title">{location.cityName}</div>
      <div className="location-quick-card-subtitle">{location.displayNameZh}</div>
      <StatusBadges isActive={isActive} isPending={isPending} isFavorite={location.isFavorite} />
    </button>
  );
};

const PickerLocationCard = ({
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
  const isActive = location.isActive;
  const codeLooksLikeStationCode = ICAO_STATION_CODE_PATTERN.test(location.code.toUpperCase());
  const stationCode = codeLooksLikeStationCode ? null : (location.stationCodes.find((code) => code !== location.code) ?? null);

  return (
    <article
      key={location.id}
      className={`location-card location-picker-card ${isActive ? "location-card-active" : "location-card-default"} ${
        location.isFavorite ? "location-card-favorite" : ""
      } ${isPending ? "location-card-pending" : ""}`}
      data-pending={isPending ? "true" : "false"}
    >
      <button
        type="button"
        onClick={() => onSelect(location.id)}
        aria-current={isActive ? "true" : "false"}
        aria-label={`${location.code} ${location.displayName}`}
        className="location-picker-select"
      >
        <div className="location-picker-card-head">
          <div className="flex flex-wrap gap-2">
            <span className="location-code-pill">{location.code}</span>
            {stationCode ? <span className="location-code-pill">ICAO {stationCode}</span> : null}
          </div>
          <StatusBadges isActive={isActive} isPending={isPending} isFavorite={location.isFavorite} />
        </div>

        <div className="location-picker-card-title">{location.cityName}</div>
        <div className="location-picker-card-subtitle">{location.displayNameZh}</div>
        <div className="location-picker-card-meta">
          <span>{location.countryName}</span>
          <span>{resolveGroupLongLabel(location.timezoneGroup)}</span>
        </div>

        <div className="location-picker-card-footer">
          <span>{RAIL_TEXT.currentTemperature}</span>
          <span className="data-mono">{formatTemperature(location.temp, location.displayUnit)}</span>
        </div>
      </button>

      <button
        type="button"
        onClick={() => onToggleFavorite(location.id)}
        disabled={favoritePending}
        aria-pressed={location.isFavorite}
        aria-label={location.isFavorite ? "取消收藏" : "收藏"}
        className="location-picker-favorite"
      >
        <Star className={`h-4 w-4 ${location.isFavorite ? "fill-[var(--warning)] text-[var(--warning)]" : "text-white/52"}`} />
      </button>
    </article>
  );
};

export const LocationRail = ({
  mobile = false,
  expanded,
  activeId,
  pendingId,
  activeGroup,
  groups,
  onGroupChange,
  onSelect,
  onToggleFavorite,
  favoritePendingIds,
  favoriteError,
  onDismiss,
  onExpand,
  returnFocusRef,
  restoreFocusOnCloseRef,
}: {
  mobile?: boolean;
  expanded: boolean;
  activeId: string;
  pendingId: string | null;
  activeGroup: DockLocation["timezoneGroup"];
  groups: DockLocationGroup[];
  onGroupChange: (group: DockLocation["timezoneGroup"]) => void;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  favoritePendingIds: string[];
  favoriteError: string | null;
  onDismiss: () => void;
  onExpand: () => void;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
  restoreFocusOnCloseRef?: MutableRefObject<boolean>;
}) => {
  const [pickerView, setPickerView] = useState<PickerView>("common");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLowerCase());
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const currentGroupItems = useMemo(
    () => groups.find((group) => group.group === activeGroup)?.items ?? [],
    [activeGroup, groups],
  );
  const allLocations = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const activeLocation = useMemo(
    () => allLocations.find((location) => location.id === activeId) ?? allLocations.find((location) => location.isActive) ?? null,
    [activeId, allLocations],
  );
  const favoriteLocations = useMemo(
    () => allLocations.filter((location) => location.isFavorite && location.id !== activeId),
    [activeId, allLocations],
  );

  const quickAccessLocations = useMemo(() => {
    const ordered = [...currentGroupItems].sort(
      (left, right) =>
        Number(right.id === activeId) - Number(left.id === activeId) ||
        Number(right.isFavorite) - Number(left.isFavorite) ||
        left.sortOrder - right.sortOrder,
    );

    const withoutActive = ordered.filter((location) => location.id !== activeId);
    return withoutActive.length > 0 ? withoutActive : ordered;
  }, [activeId, currentGroupItems]);

  const filteredLocations = useMemo(() => {
    if (!deferredSearchQuery) {
      return [];
    }

    return allLocations
      .map((location) => {
        const searchKey = buildSearchKey(location);
        const code = location.code.toLowerCase();
        const stationCodes = location.stationCodes.map((stationCode) => stationCode.toLowerCase());
        const city = location.cityName.toLowerCase();
        const displayName = location.displayName.toLowerCase();
        const displayNameZh = location.displayNameZh.toLowerCase();
        const country = location.countryName.toLowerCase();

        let score = 0;
        let matchPriority = 0;
        if (stationCodes.includes(deferredSearchQuery)) {
          matchPriority = 6;
          score += 130;
        } else if (stationCodes.some((stationCode) => stationCode.startsWith(deferredSearchQuery))) {
          matchPriority = 5;
          score += 95;
        } else if (code === deferredSearchQuery) {
          matchPriority = 6;
          score += 125;
        } else if (code.startsWith(deferredSearchQuery)) {
          matchPriority = 4;
          score += 80;
        } else if (
          city.startsWith(deferredSearchQuery) ||
          displayName.startsWith(deferredSearchQuery) ||
          displayNameZh.startsWith(deferredSearchQuery)
        ) {
          matchPriority = 3;
          score += 60;
        } else if (searchKey.includes(deferredSearchQuery)) {
          matchPriority = 2;
          score += 30;
        }

        if (country.includes(deferredSearchQuery)) {
          matchPriority = Math.max(matchPriority, 1);
          score += 8;
        }

        if (score <= 0) {
          return { location, score: 0, matchPriority: 0 };
        }

        if (location.isFavorite) {
          score += 6;
        }
        if (location.id === activeId) {
          score += 10;
        }
        if (location.timezoneGroup === activeGroup) {
          score += 4;
        }

        return { location, score, matchPriority };
      })
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          right.matchPriority - left.matchPriority ||
          right.score - left.score ||
          Number(right.location.isFavorite) - Number(left.location.isFavorite) ||
          left.location.sortOrder - right.location.sortOrder ||
          left.location.displayName.localeCompare(right.location.displayName),
      )
      .map((entry) => entry.location);
  }, [activeGroup, activeId, allLocations, deferredSearchQuery]);
  const activeLocationFavoritePending = activeLocation ? favoritePendingIds.includes(activeLocation.id) : false;

  const commonSections = useMemo(
    () => [
      {
        key: "current",
        eyebrow: RAIL_TEXT.currentLocation,
        title: activeLocation ? `${activeLocation.cityName} 正在工作中` : "当前地点",
        items: activeLocation ? [activeLocation] : [],
      },
      {
        key: "favorites",
        eyebrow: "收藏地点",
        title: favoriteLocations.length ? `已收藏 ${favoriteLocations.length} 个地点` : "收藏地点",
        items: favoriteLocations.slice(0, 8),
      },
      {
        key: "group",
        eyebrow: `${resolveGroupLongLabel(activeGroup)} 快切`,
        title: `当前分组 ${currentGroupItems.length} 个地点`,
        items: currentGroupItems.filter((location) => location.id !== activeId).slice(0, 10),
      },
    ],
    [activeGroup, activeLocation, currentGroupItems, favoriteLocations],
  );
  const favoritePickerItems = useMemo(
    () => dedupeLocations([activeLocation?.isFavorite ? activeLocation : null, ...favoriteLocations]),
    [activeLocation, favoriteLocations],
  );
  const mobileCommonItems = useMemo(
    () => dedupeLocations([...favoriteLocations, ...quickAccessLocations]).slice(0, 10),
    [favoriteLocations, quickAccessLocations],
  );
  const mobileGroupItems = useMemo(() => {
    const nextItems = currentGroupItems.filter((location) => location.id !== activeId);
    return nextItems.length > 0 ? nextItems : currentGroupItems;
  }, [activeId, currentGroupItems]);

  const groupPanelTitle = useMemo(() => {
    if (deferredSearchQuery) {
      return "搜索结果";
    }

    if (pickerView === "favorites") {
      return "收藏地点";
    }

    if (pickerView === "group") {
      return resolveGroupLongLabel(activeGroup);
    }

    return "常用地点";
  }, [activeGroup, deferredSearchQuery, pickerView]);

  const groupPanelCopy = useMemo(() => {
    if (deferredSearchQuery) {
      return "支持机场码、英文城市名和中文名混搜，优先把最可能命中的地点放到前面。";
    }

    if (pickerView === "favorites") {
      return "把高频城市收进同一屏，减少来回切组的时间。";
    }

    if (pickerView === "group") {
      return resolveGroupDescription(activeGroup);
    }

    return "把当前城市、收藏地点和当前分组放在一屏里，先命中最常用的入口。";
  }, [activeGroup, deferredSearchQuery, pickerView]);
  const mobileResultTitle = useMemo(() => {
    if (deferredSearchQuery) {
      return "搜索结果";
    }

    if (pickerView === "favorites") {
      return "收藏地点";
    }

    if (pickerView === "group") {
      return resolveGroupLongLabel(activeGroup);
    }

    return "收藏与常用";
  }, [activeGroup, deferredSearchQuery, pickerView]);
  const mobileResultCopy = useMemo(() => {
    if (deferredSearchQuery) {
      return "搜索优先展示最可能命中的地点，清空后会回到单手入口。";
    }

    if (pickerView === "favorites") {
      return favoriteLocations.length
        ? "把高频地点收在首屏，切换时不需要再回到桌面式双栏。"
        : "还没有额外收藏地点，先从下方城市卡片里点亮星标。";
    }

    if (pickerView === "group") {
      return `${resolveGroupDescription(activeGroup)} 当前分组会继续留在同一条滚动流里。`;
    }

    return "先看收藏，再从当前分组的常用地点里就近切到下一个城市。";
  }, [activeGroup, deferredSearchQuery, favoriteLocations.length, pickerView]);
  const mobileResultItems = useMemo(() => {
    if (deferredSearchQuery) {
      return filteredLocations;
    }

    if (pickerView === "favorites") {
      return favoritePickerItems;
    }

    if (pickerView === "group") {
      return mobileGroupItems;
    }

    return mobileCommonItems;
  }, [deferredSearchQuery, favoritePickerItems, filteredLocations, mobileCommonItems, mobileGroupItems, pickerView]);

  useEffect(() => {
    if (!expanded) {
      setPickerView("common");
      setSearchQuery("");

      if (!mobile || !restoreFocusOnCloseRef?.current) {
        return;
      }

      restoreFocusOnCloseRef.current = false;
      const trigger = returnFocusRef?.current;
      if (!trigger) {
        return;
      }

      const frameId = window.requestAnimationFrame(() => {
        trigger.focus();
      });

      return () => window.cancelAnimationFrame(frameId);
    }

    if (mobile) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [expanded, mobile, restoreFocusOnCloseRef, returnFocusRef]);

  const focusSearchInput = () => {
    searchInputRef.current?.focus();
  };

  const renderSectionGrid = (items: DockLocation[]) => {
    if (!items.length) {
      return (
        <div className="location-picker-empty">
          <div className="location-picker-empty-title">{RAIL_TEXT.searchEmpty}</div>
          <div className="location-picker-empty-copy">
            {deferredSearchQuery ? RAIL_TEXT.searchHint : RAIL_TEXT.favoritesEmpty}
          </div>
        </div>
      );
    }

    return (
      <div className="location-picker-grid">
        {items.map((location) => (
          <Fragment key={location.id}>
            <PickerLocationCard
              location={location}
              favoritePendingIds={favoritePendingIds}
              pendingId={pendingId}
              onSelect={onSelect}
              onToggleFavorite={onToggleFavorite}
            />
          </Fragment>
        ))}
      </div>
    );
  };

  const searchField = (
    <label className="location-rail-search">
      <Search className="h-4 w-4 text-[var(--accent)]" />
      <input
        ref={searchInputRef}
        type="search"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder={RAIL_TEXT.searchPlaceholder}
        aria-label={RAIL_TEXT.searchPlaceholder}
      />
    </label>
  );
  const activeLocationAnchor = activeLocation ? (
    <div className="location-rail-anchor location-rail-anchor-static">
      <div className="location-rail-anchor-head">
        <span className="eyebrow">{RAIL_TEXT.currentLocation}</span>
        <span className="data-mono location-rail-anchor-temp">
          {formatTemperature(activeLocation.temp, activeLocation.displayUnit)}
        </span>
      </div>
      <div className="location-rail-anchor-title">{activeLocation.cityName}</div>
      <div className="location-rail-anchor-copy">{activeLocation.displayNameZh}</div>
      <div className="location-rail-anchor-meta">
        <span className="location-code-pill">{activeLocation.code}</span>
        <StatusBadges isActive isPending={pendingId === activeLocation.id} isFavorite={activeLocation.isFavorite} />
        <button
          type="button"
          onClick={() => onToggleFavorite(activeLocation.id)}
          disabled={activeLocationFavoritePending}
          aria-pressed={activeLocation.isFavorite}
          aria-label={activeLocation.isFavorite ? "取消收藏" : "收藏"}
          className="location-rail-anchor-favorite"
        >
          <Star
            className={`h-4 w-4 ${activeLocation.isFavorite ? "fill-[var(--warning)] text-[var(--warning)]" : "text-white/58"}`}
          />
        </button>
      </div>
    </div>
  ) : null;
  const favoriteErrorMessage = favoriteError ? (
    <div className="location-rail-error" aria-live="polite">
      {favoriteError}
    </div>
  ) : null;
  const groupButtons = groups.map((group) => {
    const active = !deferredSearchQuery && pickerView === "group" && group.group === activeGroup;

    return (
      <button
        key={group.group}
        type="button"
        onClick={() => {
          setSearchQuery("");
          setPickerView("group");
          onGroupChange(group.group);
        }}
        className={`location-rail-group-panel-button ${active ? "is-active" : ""}`}
        aria-pressed={active}
      >
        <span className="location-rail-group-panel-head">
          <span>{resolveGroupLongLabel(group.group)}</span>
          <span className="data-mono">{group.items.length}</span>
        </span>
        <span className="location-rail-group-panel-copy">{resolveGroupDescription(group.group)}</span>
      </button>
    );
  });
  const mobileViewSwitch = (
    <div className="location-rail-view-switch location-rail-view-switch-mobile">
      <button
        type="button"
        className={`location-rail-view-button ${pickerView === "common" && !deferredSearchQuery ? "is-active" : ""}`}
        aria-pressed={pickerView === "common" && !deferredSearchQuery}
        onClick={() => {
          setSearchQuery("");
          setPickerView("common");
        }}
      >
        常用
      </button>

      <button
        type="button"
        className={`location-rail-view-button ${pickerView === "favorites" && !deferredSearchQuery ? "is-active" : ""}`}
        aria-pressed={pickerView === "favorites" && !deferredSearchQuery}
        onClick={() => {
          setSearchQuery("");
          setPickerView("favorites");
        }}
      >
        收藏
      </button>

      <button
        type="button"
        className={`location-rail-view-button ${pickerView === "group" && !deferredSearchQuery ? "is-active" : ""}`}
        aria-pressed={pickerView === "group" && !deferredSearchQuery}
        onClick={() => {
          setSearchQuery("");
          setPickerView("group");
        }}
      >
        分组
      </button>
    </div>
  );
  const mobileStickyControls = (
    <div className="location-rail-mobile-sticky-band">
      {searchField}
      {mobileViewSwitch}
    </div>
  );

  const pickerShell = (
    <div className="panel-section location-rail-picker-shell">
      <div className="location-rail-canvas-header">
        <div>
          <div className="eyebrow flex items-center gap-2">
            <MapPinned className="h-4 w-4 text-[var(--accent)]" />
            城市选择器
          </div>
          <h2 className="location-rail-canvas-title">先搜索，再按分组落位</h2>
          <p className="location-rail-canvas-copy">
            左侧负责搜索和分组，右侧只保留你真正会点的城市卡片，减少长滚动和误切换。
          </p>
        </div>

        <button type="button" className="location-rail-close-button" onClick={onDismiss} aria-label={RAIL_TEXT.closeRail}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="location-rail-picker-layout">
        <div className="location-rail-picker-sidebar">
          {searchField}

          {activeLocationAnchor}

          <div className="location-rail-view-switch">
            <button
              type="button"
              className={`location-rail-view-button ${pickerView === "common" && !deferredSearchQuery ? "is-active" : ""}`}
              aria-pressed={pickerView === "common" && !deferredSearchQuery}
              onClick={() => {
                setSearchQuery("");
                setPickerView("common");
              }}
            >
              常用
            </button>

            <button
              type="button"
              className={`location-rail-view-button ${pickerView === "favorites" && !deferredSearchQuery ? "is-active" : ""}`}
              aria-pressed={pickerView === "favorites" && !deferredSearchQuery}
              onClick={() => {
                setSearchQuery("");
                setPickerView("favorites");
              }}
            >
              收藏
            </button>
          </div>

          <div className="location-rail-group-list">
            {groupButtons}
          </div>

          {favoriteErrorMessage}
        </div>

        <div className="location-rail-picker-main">
          <div className="location-rail-picker-toolbar">
            <div>
              <div className="eyebrow">
                {deferredSearchQuery ? `搜索 ${filteredLocations.length} 个命中` : groupPanelTitle}
              </div>
              <h3>{groupPanelTitle}</h3>
              <p>{groupPanelCopy}</p>
            </div>

            <div className="location-rail-picker-toolbar-stats">
              <span>{allLocations.length} 个城市</span>
              <span>{favoriteLocations.length + Number(Boolean(activeLocation?.isFavorite))} 个收藏</span>
              <span>{`${resolveGroupLongLabel(activeGroup)} ${currentGroupItems.length}`}</span>
            </div>
          </div>

          <div className="location-rail-picker-scroll scrollbar-terminal">
            {deferredSearchQuery ? (
              renderSectionGrid(filteredLocations)
            ) : pickerView === "favorites" ? (
              renderSectionGrid(favoritePickerItems)
            ) : pickerView === "group" ? (
              renderSectionGrid(currentGroupItems)
            ) : (
              <div className="location-picker-section-stack">
                {commonSections.map((section) => (
                  <section key={section.key} className="location-picker-section">
                    <div className="location-picker-section-head">
                      <div>
                        <div className="eyebrow">{section.eyebrow}</div>
                        <h4>{section.title}</h4>
                      </div>
                      <span className="location-picker-section-meta">{section.items.length} 个地点</span>
                    </div>
                    {renderSectionGrid(section.items)}
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
  const mobilePickerShell = (
    <div className="panel-section location-rail-picker-shell location-rail-picker-shell-mobile">
      <div className="location-rail-canvas-header">
        <div>
          <div className="eyebrow flex items-center gap-2">
            <MapPinned className="h-4 w-4 text-[var(--accent)]" />
            城市选择器
          </div>
          <h2 className="location-rail-canvas-title">单手切到下一个地点</h2>
          <p className="location-rail-canvas-copy">
            搜索优先，当前地点、收藏与分组入口保持在一条连续滚动流里。
          </p>
        </div>

        <button type="button" className="location-rail-close-button" onClick={onDismiss} aria-label={RAIL_TEXT.closeRail}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="location-rail-mobile-flow scrollbar-terminal">
        {mobileStickyControls}
        {activeLocationAnchor}
        {favoriteErrorMessage}

        {deferredSearchQuery ? (
          <section className="location-rail-mobile-section location-rail-mobile-section--results">
            <div className="location-rail-mobile-section-head">
              <div className="location-rail-mobile-section-copy">
                <div className="eyebrow">搜索命中</div>
                <h3>{mobileResultTitle}</h3>
                <p>{mobileResultCopy}</p>
              </div>
              <span className="location-rail-mobile-section-meta">{mobileResultItems.length} 个地点</span>
            </div>
            {renderSectionGrid(mobileResultItems)}
          </section>
        ) : (
          <>
            <section className="location-rail-mobile-section">
              <div className="location-rail-mobile-section-head">
                <div className="location-rail-mobile-section-copy">
                  <div className="eyebrow">{pickerView === "group" ? "分组浏览" : "收藏 / 常用"}</div>
                  <h3>{pickerView === "favorites" ? "收藏地点" : pickerView === "group" ? "先选分组入口" : "收藏与常用"}</h3>
                  <p>
                    {pickerView === "favorites"
                      ? mobileResultCopy
                      : pickerView === "group"
                        ? "先选一个分组入口，再在下方继续筛选地点。"
                        : mobileResultCopy}
                  </p>
                </div>
              </div>
              {pickerView === "group" ? null : renderSectionGrid(mobileResultItems)}
            </section>

            <section className="location-rail-mobile-section location-rail-mobile-section--group-entry">
              <div className="location-rail-mobile-section-head">
                <div className="location-rail-mobile-section-copy">
                  <div className="eyebrow">分组入口</div>
                  <h3>{pickerView === "group" ? `${resolveGroupLongLabel(activeGroup)} 快切` : "按时区分组切换"}</h3>
                  <p>
                    {pickerView === "group"
                      ? resolveGroupDescription(activeGroup)
                      : "只保留最常用的分组入口，不再把整块桌面侧栏硬塞进手机 sheet。"}
                  </p>
                </div>
              </div>
              <div className="location-rail-group-list location-rail-group-list-mobile">{groupButtons}</div>
            </section>

            {pickerView === "group" ? (
              <section className="location-rail-mobile-section location-rail-mobile-section--results">
                <div className="location-rail-mobile-section-head">
                  <div className="location-rail-mobile-section-copy">
                    <div className="eyebrow">{resolveGroupLongLabel(activeGroup)} 分组</div>
                    <h3>{mobileResultTitle}</h3>
                    <p>{mobileResultCopy}</p>
                  </div>
                  <span className="location-rail-mobile-section-meta">{mobileResultItems.length} 个地点</span>
                </div>
                {renderSectionGrid(mobileResultItems)}
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  if (mobile) {
    if (!expanded) {
      return null;
    }

    return (
      <Sheet
        open={expanded}
        onOpenChange={(open) => {
          if (!open) {
            onDismiss();
          }
        }}
      >
        <SheetContent
          id="mobile-location-rail-sheet"
          side="bottom"
          className="location-rail-mobile-sheet max-h-[min(92svh,920px)] overflow-hidden p-0 [&>button]:hidden"
          aria-label={RAIL_TEXT.ariaLabel}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            focusSearchInput();
          }}
          onCloseAutoFocus={(event) => {
            if (!restoreFocusOnCloseRef?.current) {
              return;
            }

            event.preventDefault();
          }}
        >
          <div className="location-rail-canvas location-rail-canvas-mobile">{mobilePickerShell}</div>
        </SheetContent>
      </Sheet>
    );
  }

  if (expanded) {
    return (
      <aside className="location-rail location-rail-expanded" aria-label={RAIL_TEXT.ariaLabel} data-expanded="true">
        <button type="button" tabIndex={-1} className="location-rail-backdrop" onClick={onDismiss} />

        <div className="location-rail-canvas terminal-panel" role="dialog" aria-modal="true" aria-label="城市选择器">
          {pickerShell}
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="terminal-panel location-rail location-rail-collapsed shrink-0 overflow-hidden"
      aria-label={RAIL_TEXT.ariaLabel}
      data-expanded="false"
    >
      <div className="panel-section location-rail-shell">
        <div className="location-rail-topmark">
          <Globe2 className="h-4 w-4 text-[var(--accent)]" />
          <span className="location-rail-topmark-label">地点</span>
        </div>

        {activeLocation ? (
          <button
            type="button"
            className="location-rail-anchor"
            onClick={onExpand}
            aria-label={RAIL_TEXT.openRail}
            aria-haspopup="dialog"
          >
            <div className="location-rail-anchor-head">
              <span className="eyebrow">{RAIL_TEXT.currentLocation}</span>
              <span className="data-mono location-rail-anchor-temp">
                {formatTemperature(activeLocation.temp, activeLocation.displayUnit)}
              </span>
            </div>
            <div className="location-rail-anchor-title">{activeLocation.cityName}</div>
            <div className="location-rail-anchor-copy">{activeLocation.displayNameZh}</div>
            <div className="location-rail-anchor-meta">
              <span className="location-code-pill">{activeLocation.code}</span>
              <StatusBadges
                isActive
                isPending={pendingId === activeLocation.id}
                isFavorite={activeLocation.isFavorite}
              />
            </div>
          </button>
        ) : null}

        <div className="location-rail-group-switcher">
          {groups.map((group) => {
            const active = group.group === activeGroup;

            return (
              <button
                key={group.group}
                type="button"
                onClick={() => onGroupChange(group.group)}
                className={`location-rail-group-button ${active ? "location-rail-group-button-active" : ""}`}
                aria-pressed={active}
                aria-label={`${group.label || resolveGroupLongLabel(group.group)} ${group.items.length} 个地点`}
                title={group.label || resolveGroupLongLabel(group.group)}
              >
                <span className="location-rail-group-button-label">{resolveGroupShortLabel(group.group)}</span>
                <span className="location-rail-group-button-meta data-mono">{group.items.length}</span>
              </button>
            );
          })}
        </div>

        <div className="location-rail-quick-head">
          <span>{`${resolveGroupLongLabel(activeGroup)} 快切`}</span>
          <button type="button" className="location-rail-expand-inline" onClick={onExpand} aria-label={RAIL_TEXT.openRail}>
            全部
          </button>
        </div>

        <div className="location-rail-quick-list scrollbar-terminal">
          {quickAccessLocations.map((location) => (
            <Fragment key={location.id}>
              <QuickLocationCard
                location={{
                  ...location,
                  isActive: location.id === activeId,
                }}
                pendingId={pendingId}
                onSelect={onSelect}
              />
            </Fragment>
          ))}
        </div>

        <button type="button" className="location-rail-expand-button" onClick={onExpand} aria-haspopup="dialog">
          打开全部城市
        </button>
      </div>
    </aside>
  );
};
