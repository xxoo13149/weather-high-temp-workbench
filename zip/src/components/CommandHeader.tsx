import {
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Home,
  MapPinned,
  Radar,
  RefreshCw,
  SignalHigh,
  TriangleAlert,
  TrendingUp,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type RefObject, useState } from "react";

import { Button } from "@/components/ui/button";
import { UI_TEXT } from "../display-text";
import { formatDateTime } from "../utils";

const HEADER_TEXT = UI_TEXT.header;

export const CommandHeader = ({
  locationName,
  locationShortName,
  locationCode,
  pendingLocationName,
  transitioning,
  locationTimezone,
  updatedAt,
  syncState,
  refreshState,
  refreshDisabled,
  currentPage,
  mobile = false,
  railExpanded,
  onToggleRail,
  onOpenRail,
  mobileLocationTriggerRef,
  onRefresh,
  onNavigateHome,
  onNavigateAnalysis,
  onNavigateKelly,
}: {
  locationName: string;
  locationShortName?: string | null;
  locationCode?: string | null;
  pendingLocationName?: string | null;
  transitioning?: boolean;
  locationTimezone?: string;
  updatedAt: string | null;
  syncState: "fresh" | "fallback_error";
  refreshState: "idle" | "pending" | "success" | "error";
  refreshDisabled: boolean;
  currentPage: "home" | "analysis" | "kelly";
  mobile?: boolean;
  railExpanded: boolean;
  onToggleRail: () => void;
  onOpenRail?: () => void;
  mobileLocationTriggerRef?: RefObject<HTMLButtonElement | null>;
  onRefresh: () => void;
  onNavigateHome: () => void;
  onNavigateAnalysis: () => void;
  onNavigateKelly: () => void;
}) => {
  const [showPhilosophy, setShowPhilosophy] = useState(false);
  const refreshLabel =
    refreshState === "pending"
      ? HEADER_TEXT.refreshPending
      : refreshState === "success"
        ? HEADER_TEXT.refreshSuccess
        : refreshState === "error"
          ? HEADER_TEXT.refreshError
          : HEADER_TEXT.refreshIdle;
  const railToggleLabel = railExpanded ? HEADER_TEXT.collapseRail : HEADER_TEXT.expandRail;
  const railToggleIcon = mobile ? (
    <MapPinned className="h-4 w-4" />
  ) : railExpanded ? (
    <ChevronLeft className="h-4 w-4" />
  ) : (
    <ChevronRight className="h-4 w-4" />
  );
  const title = mobile ? locationShortName ?? locationName : locationName;
  const syncLabel = syncState === "fallback_error" ? HEADER_TEXT.stale : HEADER_TEXT.synced;
  const showMobileRefreshState = mobile && refreshState !== "idle";
  const homeLabel = mobile ? "总览" : HEADER_TEXT.home;
  const analysisLabel = mobile ? "分析" : HEADER_TEXT.analysis;
  const kellyLabel = mobile ? "Kelly" : HEADER_TEXT.kelly;
  const handleMobileRailOpen = onOpenRail ?? onToggleRail;

  const locationSummary = (
    <>
      <div className="eyebrow flex items-center gap-2 text-white/56">
        <SignalHigh className="h-3.5 w-3.5 text-[rgba(107,231,255,0.92)]" />
        {HEADER_TEXT.productName}
        {mobile && locationCode ? (
          <span className="command-header-location-code rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] tracking-[0.08em] text-white/48">
            {locationCode}
          </span>
        ) : null}
      </div>

      <h1 className="command-header-title truncate text-[clamp(1.18rem,1.8vw,1.68rem)] font-semibold tracking-[-0.02em] text-white">
        {title}
      </h1>
    </>
  );

  const transitionBanner =
    transitioning && pendingLocationName ? (
      <div
        className="command-header-transition rounded-full border border-[rgba(107,231,255,0.16)] bg-[rgba(107,231,255,0.08)] px-2.5 py-1 text-[11px] text-[rgba(182,244,255,0.92)]"
        aria-live="polite"
      >
        正在切换到 {pendingLocationName}
      </div>
    ) : null;

  const statusPill = (
    <div
      className={`status-pill command-header-status flex items-center gap-2 rounded-full border border-white/10 bg-[rgba(12,17,26,0.78)] px-2.5 py-1.5 ${
        mobile ? "command-header-status--mobile" : ""
      }`}
      data-tone={syncState}
    >
      <span className="inline-flex h-2.5 w-2.5 rounded-full bg-current" />
      <span className="text-xs uppercase tracking-[0.12em] text-white/72">{syncLabel}</span>
      <span className="command-header-status-time data-mono text-[11px] text-white/50">
        {updatedAt ? formatDateTime(updatedAt, locationTimezone) : "--"}
      </span>
    </div>
  );

  const desktopThesis = (
    <div className="command-header-thesis-shell">
      <button
        type="button"
        onClick={() => setShowPhilosophy((current) => !current)}
        className="command-header-thesis-trigger"
        aria-expanded={showPhilosophy}
      >
        <span className="command-header-thesis-copy">
          <span className="command-header-thesis-kicker">{HEADER_TEXT.philosophyLabel}</span>
          <span className="command-header-thesis-summary">{HEADER_TEXT.philosophyCompact}</span>
        </span>
        {showPhilosophy ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      <AnimatePresence initial={false}>
        {showPhilosophy ? (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -6 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -6 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="command-header-thesis-panel"
          >
            <div className="command-header-thesis-body">{HEADER_TEXT.philosophyExpanded}</div>
            <div className="command-header-thesis-hint">{HEADER_TEXT.philosophyHint}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );

  const refreshButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onRefresh}
      disabled={refreshDisabled}
      className={`command-header-refresh border border-white/12 bg-[rgba(12,17,26,0.76)] text-white/84 hover:border-white/20 hover:bg-[rgba(14,20,31,0.9)] ${
        mobile ? "command-header-refresh--mobile" : "justify-start"
      }`}
      data-refresh-state={refreshState}
    >
      {refreshState === "success" ? (
        <CheckCheck className="mr-2 h-4 w-4 text-[var(--success)]" />
      ) : refreshState === "error" ? (
        <TriangleAlert className="mr-2 h-4 w-4 text-[var(--danger)]" />
      ) : (
        <RefreshCw
          className={`mr-2 h-4 w-4 ${refreshState === "pending" ? "animate-spin text-[var(--accent)]" : ""}`}
        />
      )}
      <span className="command-header-refresh-copy">{HEADER_TEXT.refresh}</span>
      {!mobile ? (
        <span className="command-header-refresh-meta ml-2 text-[11px] text-white/52" aria-live="polite">
          {refreshLabel}
        </span>
      ) : null}
    </Button>
  );

  const navigationCluster = (
    <div className="command-header-nav-cluster">
      <Button
        type="button"
        variant={currentPage === "home" ? "default" : "ghost"}
        size="sm"
        onClick={onNavigateHome}
        className="command-header-nav"
        data-active={currentPage === "home"}
      >
        <Home className="mr-2 h-4 w-4" />
        <span className="command-header-nav-copy">{homeLabel}</span>
      </Button>

      <Button
        type="button"
        variant={currentPage === "analysis" ? "default" : "secondary"}
        size="sm"
        onClick={onNavigateAnalysis}
        className="command-header-nav"
        data-active={currentPage === "analysis"}
      >
        <Radar className="mr-2 h-4 w-4" />
        <span className="command-header-nav-copy">{analysisLabel}</span>
      </Button>

      <Button
        type="button"
        variant={currentPage === "kelly" ? "default" : "secondary"}
        size="sm"
        onClick={onNavigateKelly}
        className="command-header-nav"
        data-active={currentPage === "kelly"}
      >
        <TrendingUp className="mr-2 h-4 w-4" />
        <span className="command-header-nav-copy">{kellyLabel}</span>
      </Button>
    </div>
  );

  return (
    <motion.header
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="terminal-panel command-header-shell px-4 py-3.5 md:px-5"
      data-page={currentPage}
      data-mobile-layout={mobile ? "true" : "false"}
      data-sync-state={syncState}
    >
      <div className="panel-section command-header-grid">
        <div className="command-header-leading">
          {mobile ? (
            <Button
              asChild
              variant="secondary"
              className="command-header-mobile-location-trigger w-full justify-start gap-3 whitespace-normal px-3 py-2.5"
            >
              <button
                ref={mobileLocationTriggerRef}
                type="button"
                onClick={handleMobileRailOpen}
                aria-label={railToggleLabel}
                aria-controls="mobile-location-rail-sheet"
                aria-haspopup="dialog"
                aria-expanded={railExpanded}
              >
                <span className="command-header-mobile-location-icon" aria-hidden="true">
                  {railToggleIcon}
                </span>
                <div className="command-header-main command-header-main--mobile-trigger">{locationSummary}</div>
              </button>
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={onToggleRail}
                className="command-header-rail-toggle mt-0.5 shrink-0 md:mt-0"
                aria-label={railToggleLabel}
              >
                {railToggleIcon}
              </Button>

              <div className="command-header-main">
                {locationSummary}
                {transitionBanner}
                <div className="command-header-meta-row">{statusPill}</div>
                {desktopThesis}
              </div>
            </>
          )}
        </div>

        <div className="command-header-center">
          <div className="command-header-nav-shell">
            {mobile ? (
              <div className="command-header-mobile-action-row">
                {navigationCluster}
                {refreshButton}
              </div>
            ) : (
              navigationCluster
            )}
          </div>
        </div>

        {mobile ? (
          <div className="command-header-utility command-header-mobile-utility">
            {transitionBanner}
            <div className="command-header-meta-row">
              {statusPill}
              {showMobileRefreshState ? (
                <span
                  className="command-header-mobile-refresh-state rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/60"
                  data-refresh-state={refreshState}
                  aria-live="polite"
                >
                  {refreshLabel}
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="command-header-utility">{refreshButton}</div>
        )}
      </div>
    </motion.header>
  );
};
