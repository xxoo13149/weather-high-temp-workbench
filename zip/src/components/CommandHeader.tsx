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
import { formatDateTime } from "../utils";

const HEADER_TEXT = {
  productName: "天气决策台",
  synced: "已同步",
  stale: "缓存回退",
  home: "首页决策台",
  analysis: "分析工作区",
  refresh: "刷新",
  refreshIdle: "待命",
  refreshPending: "刷新中",
  refreshSuccess: "已更新",
  refreshError: "刷新失败",
  favorite: "收藏当前地点",
  unfavorite: "取消收藏",
  expandRail: "展开地点侧栏",
  collapseRail: "收起地点侧栏",
} as const;

export const CommandHeader = ({
  locationName,
  pendingLocationName,
  transitioning,
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
  pendingLocationName?: string | null;
  transitioning?: boolean;
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
      ? HEADER_TEXT.refreshPending
      : refreshState === "success"
        ? HEADER_TEXT.refreshSuccess
        : refreshState === "error"
          ? HEADER_TEXT.refreshError
          : HEADER_TEXT.refreshIdle;

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
            aria-label={railExpanded ? HEADER_TEXT.collapseRail : HEADER_TEXT.expandRail}
          >
            {railExpanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>

          <div className="command-header-main">
            <div className="eyebrow flex items-center gap-2 text-white/56">
              <SignalHigh className="h-3.5 w-3.5 text-[rgba(107,231,255,0.92)]" />
              {HEADER_TEXT.productName}
            </div>

            <h1 className="command-header-title truncate text-[clamp(1.18rem,1.8vw,1.68rem)] font-semibold tracking-[-0.02em] text-white">
              {locationName}
            </h1>

            {transitioning && pendingLocationName ? (
              <div
                className="command-header-transition rounded-full border border-[rgba(107,231,255,0.16)] bg-[rgba(107,231,255,0.08)] px-2.5 py-1 text-[11px] text-[rgba(182,244,255,0.92)]"
                aria-live="polite"
              >
                正在切换到 {pendingLocationName}
              </div>
            ) : null}

            <div className="command-header-meta-row">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={onToggleFavorite}
                disabled={favoriteDisabled}
                aria-label={favorite ? HEADER_TEXT.unfavorite : HEADER_TEXT.favorite}
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
                  {syncState === "stale" ? HEADER_TEXT.stale : HEADER_TEXT.synced}
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

        <div className="command-header-center">
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
                {HEADER_TEXT.home}
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
                {HEADER_TEXT.analysis}
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
            <span>{HEADER_TEXT.refresh}</span>
            <span className="ml-2 text-[11px] text-white/52" aria-live="polite">
              {refreshLabel}
            </span>
          </Button>
        </div>
      </div>
    </motion.header>
  );
};
