import { ArrowUpRight, MapPin, RefreshCw, Sigma, Thermometer, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { KellyRiskMode, KellyWorkbenchData } from "@/lib/kelly";
import { cn } from "@/lib/utils";

type KellyControlBarProps = {
  data: KellyWorkbenchData;
  disabled?: boolean;
  refreshing?: boolean;
  onLocationChange?: (locationId: string) => void;
  onTargetDateChange?: (targetDate: string) => void;
  onBankrollChange?: (value: string) => void;
  onMinEdgeChange?: (value: string) => void;
  onActualTemperatureChange?: (value: string) => void;
  onRiskModeChange?: (riskMode: KellyRiskMode) => void;
  onRefresh?: () => void;
};

const fieldClassName =
  "kelly-field-control data-mono w-full rounded-[16px] border border-white/8 bg-black/20 px-3 py-3 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-[var(--border-strong)]";

const renderFieldError = (message?: string | null) =>
  message ? <span className="kelly-field__error">{message}</span> : null;

export const KellyControlBar = ({
  data,
  disabled = false,
  refreshing = false,
  onLocationChange,
  onBankrollChange,
  onMinEdgeChange,
  onActualTemperatureChange,
  onRiskModeChange,
  onRefresh,
}: KellyControlBarProps) => (
  <section className="kelly-block kelly-control-panel">
    <div className="kelly-block__header">
      <div>
        <div className="eyebrow">控制条</div>
        <h3 className="kelly-block__title">地点和日期立即切换，参数改动先草稿，点击刷新分析后应用</h3>
      </div>
      <div className="kelly-control-panel__hint">
        `minEdge` 只影响高亮和执行建议，地点与日期切换立即生效。
      </div>
    </div>

    <div className="kelly-controls-grid">
      <label className="kelly-field">
        <span className="kelly-field__label">
          <MapPin className="h-4 w-4 text-[var(--accent)]" />
          地点
        </span>
        <select
          className={cn(fieldClassName, "appearance-none")}
          value={data.locationId}
          disabled={disabled}
          onChange={(event) => onLocationChange?.(event.target.value)}
        >
          {data.locationOptions.map((option) => (
            <option key={option.id} value={option.id} disabled={option.disabled}>
              {option.labelZh ? `${option.labelZh} / ${option.label}` : option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="kelly-field">
        <span className="kelly-field__label">
          <WalletCards className="h-4 w-4 text-[var(--warning)]" />
          本金
        </span>
        <input
          className={fieldClassName}
          type="text"
          inputMode="decimal"
          placeholder="1000"
          value={data.bankrollInput}
          disabled={disabled}
          onChange={(event) => onBankrollChange?.(event.target.value)}
        />
        {renderFieldError(data.fieldErrors?.bankroll)}
      </label>

      <label className="kelly-field">
        <span className="kelly-field__label">
          <Sigma className="h-4 w-4 text-[var(--accent-secondary)]" />
          最小优势 %
        </span>
        <input
          className={fieldClassName}
          type="text"
          inputMode="decimal"
          placeholder="2.0"
          value={data.minEdgeInput}
          disabled={disabled}
          onChange={(event) => onMinEdgeChange?.(event.target.value)}
        />
        {renderFieldError(data.fieldErrors?.minEdge)}
      </label>

      <label className="kelly-field">
        <span className="kelly-field__label">
          <Thermometer className="h-4 w-4 text-[var(--success)]" />
          参考温度
        </span>
        <input
          className={fieldClassName}
          type="text"
          inputMode="decimal"
          placeholder="留空则使用系统参考值"
          value={data.actualTemperatureInput}
          disabled={disabled}
          onChange={(event) => onActualTemperatureChange?.(event.target.value)}
        />
        {renderFieldError(data.fieldErrors?.actualTemperature)}
      </label>

      <label className="kelly-field">
        <span className="kelly-field__label">风险模式</span>
        <select
          className={cn(fieldClassName, "appearance-none")}
          value={data.riskMode}
          disabled={disabled}
          onChange={(event) => onRiskModeChange?.(event.target.value as KellyRiskMode)}
        >
          {data.riskModeOptions.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="kelly-field kelly-field--actions">
        <span className="kelly-field__label">动作</span>
        <div className="kelly-control-actions">
          <Button
            type="button"
            variant="secondary"
            className="kelly-action-button"
            disabled={disabled || data.refreshDisabled || !onRefresh}
            onClick={() => onRefresh?.()}
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            {refreshing ? "正在刷新" : data.draftDirty ? "应用并刷新" : "刷新分析"}
          </Button>

          {data.marketUrl ? (
            <Button type="button" variant="outline" className="kelly-action-button" asChild>
              <a href={data.marketUrl} target="_blank" rel="noreferrer">
                打开市场
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </Button>
          ) : (
            <Button type="button" variant="outline" className="kelly-action-button" disabled>
              打开市场
            </Button>
          )}
        </div>
      </div>
    </div>
  </section>
);
