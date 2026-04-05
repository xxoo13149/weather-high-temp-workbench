# 多模型洞察语义决策

- 时间: 2026-03-31 22:35 Asia/Shanghai
- 变更编号: DEC-20260331-01
- 状态: Accepted

## 背景

原有首页把多模型排序、峰值候选、当前分布混在一起，导致用户难以直接得到“当前参考温度下最接近的是哪个模型、该模型当天最高温是多少”这一核心结论。与此同时，源站 Highcharts 同时提供 `point.name` 和 `point.x`，旧逻辑对 `point.x` 做了额外时区换算，出现固定 `+8h` 时间错位。

## 决策

1. 多模型时间真值优先使用 `point.name` 解析为上海本地小时。
2. `point.x` 只用于排序与偏移检测，不再作为业务时间真值。
3. 首页只展示单一 `closestModel` 结论。
4. 全量 `rankedModels[]` 和 `peakTimeDistribution[]` 只放在详情抽屉。
5. “当天最高温”统一按所选洞察时刻所属的上海自然日 `00:00-23:59` 计算。
6. 首页原图区域改为信息卡，不再展示无意义缩略图。

## 接口影响

- `GET /api/weather/multimodel/insights`
  - 移除旧 `matchedModels/currentDistribution/dayPeakCandidates` 首页语义依赖
  - 核心字段改为 `referenceTemperature`、`closestModel`、`rankedModels[]`、`peakTimeDistribution[]`
- `GET /api/weather/multimodel/distribution`
  - 时间字段全部使用修正后的本地小时

## 回退方式

1. 回退前端到只展示“读取失败/暂无结果”的保守信息卡。
2. 回退后端 `insights` 响应到上一版契约前，先同步恢复前端调用。
