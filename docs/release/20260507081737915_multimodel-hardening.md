# v0.1.3-multimodel-hardening

## 改动
- 多模型后台刷新改为前台优先，并预留 1 个前台并发槽，避免 7-8 个城市快速切换时被后台刷新全部占满。
- 多模型公开响应不再输出原始 `diagnosticMessage`，只保留用户可读文案和 `diagnosticCode`。
- 切城提交前的 analysis surface 在 pending 期间清空旧城市内容，避免旧分析残影短暂回刷。
- 切城 pending 期间多模型图片不再沿用旧城市 `imageUrl`，并通过重挂载避免旧图短闪。

## 验证
- `npm test -- tests\meteoblue-service.test.ts tests\cloudflare-worker.test.ts tests\cache.test.ts tests\app.test.ts`
- `npm run check`
- `npm --prefix zip run build`
