import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Home,
  Radar,
  RefreshCw,
  SignalHigh,
  Star,
  TriangleAlert,
  TrendingUp,
} from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { UI_TEXT } from "../display-text";
import { formatDateTime } from "../utils";

export const CommandHeader = ({
  locationName,
  locationTimezone,
  updatedAt,
  syncState,
  refreshState,
  refreshDisabled,
  currentPage,
  railExpanded,
  favorite,
  favoriteDisabled,
  favoriteError,
  onToggleRail,
  onRefresh,
  onToggleFavorite,
  onNavigateHome,
  onNavigateAnalysis,
  onNavigateKelly,
}: {
  locationName: string;
  locationTimezone?: string;
  updatedAt: string | null;
  syncState: "fresh" | "stale";
  refreshState: "idle" | "pending" | "success" | "error";
  refreshDisabled: boolean;
  currentPage: "home" | "analysis" | "kelly";
  railExpanded: boolean;
  favorite: boolean;
  favoriteDisabled: boolean;
  favoriteError: string | null;
  onToggleRail: () => void;
  onRefresh: () => void;
  onToggleFavorite: () => void;
  onNavigateHome: () => void;
  onNavigateAnalysis: () => void;
  onNavigateKelly: () => void;
}) => {
  const refreshLabel =
    refreshState === "pending"
      ? UI_TEXT.header.refreshPending
      : refreshState === "success"
        ? UI_TEXT.header.refreshSuccess
        : refreshState === "error"
          ? UI_TEXT.header.refreshError
          : UI_TEXT.header.refreshIdle;

  return (
    <motion.header
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="terminal-panel command-header-shell px-4 py-3.5 md:px-5"
      data-page={currentPage}
      data-sync-state={syncState}
    >
      <div className="panel-section command-header-grid">
        <div className="command-header-leading">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={onToggleRail}
            className="command-header-rail-toggle mt-0.5 shrink-0 md:mt-0"
            aria-label={railExpanded ? UI_TEXT.header.collapseRail : UI_TEXT.header.expandRail}
          >
            {railExpanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>

          <div className="command-header-main">
            <div className="eyebrow flex items-center gap-2 text-white/56">
              <SignalHigh className="h-3.5 w-3.5 text-[rgba(107,231,255,0.92)]" />
              {UI_TEXT.header.productName}
            </div>

            <div className="command-header-title-row">
              <h1 className="truncate text-[clamp(1.18rem,1.8vw,1.68rem)] font-semibold tracking-[-0.02em] text-white">
                {locationName}
              </h1>

              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={onToggleFavorite}
                disabled={favoriteDisabled}
                aria-label={favorite ? UI_TEXT.header.unfavorite : UI_TEXT.header.favorite}
                className="h-8.5 w-8.5 rounded-full border-white/12 bg-[rgba(12,17,26,0.78)]"
              >
                <Star
                  className={`h-4 w-4 ${favorite ? "fill-[var(--warning)] text-[var(--warning)]" : "text-white/58"}`}
                />
              </Button>

              <div
                className="status-pill command-header-status flex items-center gap-2 rounded-full border border-white/10 bg-[rgba(12,17,26,0.78)] px-2.5 py-1.5"
                data-tone={syncState}
              >
                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-current" />
                <span className="text-xs uppercase tracking-[0.12em] text-white/72">
                  {syncState === "stale" ? UI_TEXT.header.stale : UI_TEXT.header.synced}
                </span>
                <span className="data-mono text-[11px] text-white/50">
                  {updatedAt ? formatDateTime(updatedAt, locationTimezone) : "--"}
                </span>
              </div>
            </div>

            {favoriteError ? (
              <div
                className="command-header-favorite-error rounded-[10px] border border-[rgba(255,200,107,0.26)] bg-[rgba(255,200,107,0.08)] px-2.5 py-1.5 text-xs text-[var(--warning)]"
                aria-live="polite"
              >
                {favoriteError}
              </div>
            ) : null}
          </div>
        </div>

        <div className="command-header-actions">
          <div className="command-header-nav-shell">
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
                {UI_TEXT.header.home}
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
                {UI_TEXT.header.analysis}
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
                Kelly 实验台
              </Button>
            </div>
          </div>

          <div className="command-header-utility">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={refreshDisabled}
              className="command-header-refresh justify-start border border-white/12 bg-[rgba(12,17,26,0.76)] text-white/84 hover:border-white/20 hover:bg-[rgba(14,20,31,0.9)]"
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
              <span>{UI_TEXT.header.refresh}</span>
              <span className="ml-2 text-[11px] text-white/52" aria-live="polite">
                {refreshLabel}
              </span>
            </Button>
          </div>
        </div>
      </div>
    </motion.header>
  );
};


