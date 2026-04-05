# 多模型洞察与原图卡片重构发布记录

- 时间: 2026-03-31 22:37 Asia/Shanghai
- 变更编号: REL-20260331-01
- 状态: Released

## 后端变更

- `parseMultiModelHighcharts()` 优先使用 `point.name` 解析上海本地小时。
- `GET /api/weather/multimodel/insights` 改为返回 `closestModel`、`rankedModels[]`、`peakTimeDistribution[]`。
- 增加 `timestampSource` 与 `xLabelOffsetMinutes` 作为时间来源证明。

## 前端变更

- 首页右侧改为“原图信息卡 + 单模型洞察卡”。
- 原图改为独立查看器，不在首页展示缩略图。
- 详情抽屉承载全量模型排序与峰值时段分布。

## 验证

- `npm run build:web`
- `npm run build:server`
- `npm run check`
- `npm run test`

## 回退方式

1. 还原 `zip/src/App.tsx` 及 `zip/src/components/*` 改动。
2. 还原 `src/providers/meteoblue/multimodel-distribution.ts` 与测试文件。
