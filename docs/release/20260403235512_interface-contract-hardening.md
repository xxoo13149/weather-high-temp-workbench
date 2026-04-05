# 接口与显示契约加固发布记录

## 关联治理件
- 快照：`D:\weather\tmp-snapshot-20260403230346_interface-contract-hardening.zip`
- 计划：`D:\weather\docs\plan\20260403230346_interface-contract-hardening.md`

## 本轮完成
- 后端中文文本链路收敛为单一契约：
  - `week.ts` 导出统一的 `sanitizeHourlySummaryZh` 与 `sanitizeReportTextZh`
  - `service.ts` 不再维护重复的简化翻译与强制摘要回退逻辑，统一复用 `week.ts` 规则
- 前端显示链路继续去重复：
  - 清理 `zip/src/utils.ts` 中已废弃的旧翻译入口
  - 删除 `zip/src/config.ts` 中前端摘要映射残留
  - 组件残留中文文案回收至 `zip/src/display-text.ts`
- 验证链路补强：
  - `vitest.config.ts` 排除 `tmp-snapshot-*`、`.npm-cache`、`zip/dist`
  - `tools/check-encoding.mjs` 与 `tests/encoding-guard.test.ts` 忽略快照目录
  - `tools/check-encoding.mjs` 新增前端构建新鲜度检查，避免源码更新后继续误用旧 `zip/dist`
  - `tests/meteoblue-service.test.ts` 补充服务层中文摘要与完整中文叙述回归断言

## 验证结果
- `npm test`：通过
- `npm run check`：通过
- `npm run build`：通过
- 构建后再次执行 `npm test`：通过

## 风险与说明
- 当前构建新鲜度检查会在 `zip/dist` 落后于 `zip/src` 时让 `npm run check` 失败，这是刻意加入的护栏，用来阻止“源码已修、页面仍在跑旧 bundle”的隐性回退。
- 小时摘要继续遵循“严格真实显示”原则：源站无可翻译摘要时保持 `null`，不做猜测式补值。
