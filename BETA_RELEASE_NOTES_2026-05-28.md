# LeadHunt AI Beta 试用版说明

版本定位：甲方试用 / Beta，不是最终成熟商用版。

## 本版适合让客户试什么

- 新建 AI 外贸员搜索任务，默认生成 30 条 query。
- 通信设备、太阳能、机械设备、泵阀、安防等外贸行业均可试跑。
- 客户池查看主客户、高匹配客户、联系方式、来源 query、来源页面、匹配理由、风险标签和客户类型。
- 对明显无效客户执行“无效”标记，让系统把来源 query 作为低产信号学习。
- 继续搜索 30 条，观察系统是否优先沿高产国家、客户类型和 query 方向扩展。

## 本版已具备的验收指标

- 主客户 / 30 query
- 高匹配客户 / 30 query
- 触达率
- 错国家比例
- 拒绝率
- Lane 覆盖
- Query 质量
- 客户可信度

## 当前通信样本表现

- 60 条 query，39 个主客户
- 主客户 / 30 query：19.5
- 高匹配 / 30 query：5
- 触达率：79.5%
- 错国家：2.6%
- 拒绝率：0%
- Lane 覆盖：8
- Query 质量：96.7%
- 客户可信度：79.5%
- 状态：接近成熟目标

## 客户试用反馈重点

- 哪些客户可以直接开发？
- 哪些客户是错行业、错国家、供应商、目录、新闻或平台？
- 哪些客户缺联系方式但公司本身有价值？
- 哪些 query 明显搜得准？
- 哪些 query 带来噪音？
- 目标国家是否合理，是否需要增加重点市场？

## 成熟目标

- 每 30 条 query 产出 10-15 个可复核主客户。
- 每 30 条 query 产出 5-8 个高匹配客户。
- 80% 以上主客户带邮箱、电话、联系表单、WhatsApp、LinkedIn、Facebook 或其他可触达入口。
- 明显错国家客户低于 10%。
- rejected 比例低于 60%。
- 每个客户都有来源 query、来源页面、匹配理由、风险标签、联系方式来源和客户类型判断。

## 打包前验证命令

```bash
pnpm --filter @leadhunt/api test -- agent-workflow.service.spec.ts lead-task.controller.spec.ts lead-qualification.service.spec.ts
pnpm --filter @leadhunt/api typecheck
pnpm --filter @leadhunt/web typecheck
pnpm --filter @leadhunt/api build
pnpm --filter @leadhunt/web build
```

本次 Beta 版上述命令均已通过。
