# V1-MVP: 关键词搜索先开搜，搜索指令后台并行

最后更新：2026-05-20

## 一句话

让 brave_search 在 expand_keywords 完成后**立即启动**消费 Lane K，**同时**后台跑 plan_search_queries（GPT 搜索指令），生成的 query 追加到队列继续被消费。**用户体感首批结果时间从 ~3 分钟降到 ~30 秒**。

## 当前状态（基线）

- ✅ **Step 1 已完成**：抽出 `buildLaneKQueriesFromKeywordGroups`，可只吃 `keywordGroups + productProfileAnalysis + customerProfileAnalysis` 生成 Lane K queries，不再依赖 plan_search_queries 输出的 keywordPool。
- ✅ **Step 2 已完成**：拆 `buildAiPlanningContext` → `runFastPlanning` + `runSlowPlanning`，保持行为不变。
- ✅ **Step 4 已完成**：`executeBraveSearchBatchForTask` 改为 polling + 原子 claim（`findFirst pending → updateMany → process`），支持 `slowPlanningPromise` 参数动态等待后台追加的 query。
- ✅ **Step 3+5 已完成**：`runAutonomousLeadDiscovery` 改为并发路径：`buildTaskFastContext` → 注入 Lane K + reverse → 启动 brave_search polling + slowPlanning 后台 → GPT query dedupe 追加。
- ✅ **Step 6 已完成**：slowPlanning 失败兜底（`.catch` → `querySource: "lane_k_only"` + `markStepFailed`）。
- ⏳ **Step 7 待做**：集成测试 + 真实任务验收。

## 当前流程（串行，慢）

```
runAutonomousLeadDiscovery (autonomous path)
  └── planTaskSearchQueries
        └── buildTaskContext
              ├── product/customer profile analysis (GPT × 2)   ← 30s
              ├── expand_keywords (GPT)                          ← 30-60s
              ├── plan_search_queries (GPT, refill ×2 if needed) ← 60-180s ← 主要瓶颈
              └── all queries createMany 入库 (Lane K + GPT + reverse)
  └── executeBraveSearchBatchForTask (consume pending queries)   ← 600-900s
```

## 目标流程（并发，快）

```
runAutonomousLeadDiscovery
  ├── fastPlanning（同步等）
  │     ├── product/customer profile analysis
  │     ├── expand_keywords
  │     ├── 用 keywordGroups 拼 Lane K (12 条 quick + 8 条 long-tail)
  │     ├── reverseNetworkQueries 拼 (4 条)
  │     └── searchQueries.createMany([Lane K quick + Lane K tail + reverse])
  │
  ├── slowPlanning（后台 fire-and-forget Promise）
  │     ├── plan_search_queries (GPT)
  │     ├── normalizeAiSearchPlan + dedupe
  │     └── searchQueries.createMany(GPT queries) ← 追加到 pending
  │
  └── executeBraveSearchPolling（while loop 消费 pending）
        ├── 原子 claim：updateMany pending → running
        ├── 跑 Brave + saveCandidates
        ├── pending == 0 时检查 slowPlanning 状态
        ├── 收敛：slowPlanning settled + pending == 0
        └── hard timeout 10 分钟兜底
```

## 实施步骤（剩余 Step 2-6）

### 实施顺序（修正版）

**重要**：原本写"Step 2+3 一起做"是错的。Step 3 让 brave_search 并发启动 + slowPlanning 后台跑，但 brave_search 是一次性读取 `task.searchQueries`，**没 Step 4 的 polling runner，slowPlanning 后追加的 GPT query 不会被消费**。

**正确顺序**：

```
阶段 1: Step 2     拆 fastPlanning/slowPlanning（结构拆开，行为不变）
                   验证：现有 214 测试不破
↓
阶段 2: Step 4     brave_search 改 polling + 原子 claim（可动态消费 pending）
                   验证：行为等价
↓
阶段 3: Step 3+5   并发启动 + dedupe 追加（真正用户加速）
                   验证：brave_search.startedAt < plan_search_queries.completedAt
↓
阶段 4: Step 6+7   失败兜底 + 测试
                   验证：5 条验收标准
```

### Step 2: 拆 buildAiPlanningContext

**文件**：`apps/api/src/agent/agent-workflow.service.ts`

把 `buildAiPlanningContext` 从单一方法拆成 3 块：

```ts
// Phase 1: 快阶段（必须等）
private async runFastPlanning(input: BuildAiPlanningInput) {
  // 1.1 product profile analysis
  // 1.2 customer profile analysis
  // 1.3 expand_keywords
  // 返回 productProfileAnalysis, customerProfileAnalysis, keywordGroups
}

// Phase 2: 慢阶段（后台）
private async runSlowPlanning(taskId: string, fastResult: FastPlanningResult, options) {
  // 2.1 plan_search_queries (GPT search-strategy)
  // 2.2 normalize + dedupe
  // 2.3 createMany pending（追加到 search_queries 表）
  // 返回 keywordPool, gptQueries, profileSignals
}

// Phase 1.5: 并发桥
private async injectFastQueries(taskId: string, fastResult: FastPlanningResult, targetMarkets: string[]) {
  // 1.5.1 用 buildLaneKQueriesFromKeywordGroups 拼 Lane K
  // 1.5.2 用 buildReverseCustomerNetworkQueries 拼 reverse
  // 1.5.3 createMany pending（前置 Lane K + reverse）
  // 返回 inserted query 数
}
```

**测试要点**：
- runFastPlanning 不调 plan_search_queries
- injectFastQueries 后 search_queries 表里有 Lane K + reverse，没有 GPT query
- runSlowPlanning 完成后 search_queries 表里有所有 query

### Step 3: 改 runAutonomousLeadDiscovery 为并发

```ts
private async runAutonomousLeadDiscovery(userId, taskId, input, options) {
  if (options.skipPlanning) {
    // recovery 路径保持不变
  } else {
    // V1-MVP 并发路径
    const fastResult = await this.runFastPlanning(input);
    await this.persistFastResult(taskId, fastResult);
    await this.injectFastQueries(taskId, fastResult, fastResult.targetMarkets);

    const slowPromise = this.runSlowPlanning(taskId, fastResult, ...)
      .catch((err) => {
        // slowPlanning 失败不影响 brave_search
        this.markStepFailed(taskId, "plan_search_queries", err.message);
        return null;
      });

    // 立刻启动 brave_search polling
    await this.executeBraveSearchPolling(userId, taskId, slowPromise);

    // 等 slow planning settle（如果还没结束）
    await slowPromise;
  }

  // ... 后续 quality gate / paused 逻辑保持不变
}
```

**关键点**：
- slowPromise 用 `.catch` 不抛错，保证 brave_search 不被中断
- executeBraveSearchPolling 接收 slowPromise，用作收敛信号

### Step 4: brave_search 改 polling + 原子 claim

新增 `executeBraveSearchPolling` 方法替代 `executeBraveSearchBatchForTask`：

```ts
private async executeBraveSearchPolling(
  userId: string,
  taskId: string,
  slowPlanningPromise: Promise<unknown>
) {
  let slowPlanningDone = false;
  slowPlanningPromise.finally(() => { slowPlanningDone = true; });

  const HARD_TIMEOUT_MS = 10 * 60 * 1000;
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
      // 兜底：10 分钟没动作强制退出
      break;
    }

    // 原子 claim：updateMany WHERE pending → running
    const candidate = await this.prisma.searchQuery.findFirst({
      where: { taskId, executionStatus: "pending" },
      orderBy: { createdAt: "asc" }
    });
    if (!candidate) {
      if (slowPlanningDone) break;  // 收敛
      await sleep(2000);
      continue;
    }

    const claimed = await this.prisma.searchQuery.updateMany({
      where: { id: candidate.id, executionStatus: "pending" },
      data: { executionStatus: "running" }
    });
    if (claimed.count === 0) continue;  // 别人抢走

    // 跑这条 query（已有 saveCandidates 状态机解耦逻辑保留）
    await this.executeQuery(taskId, candidate);
  }

  // 标记 brave_search 完成
  await this.markStepCompleted(taskId, "brave_search", { ... });
}
```

**关键点**：
- 用 `findFirst + updateMany` 实现原子 claim（Prisma 7 没有原生 RETURNING）
- 收敛：`pending == 0 && slowPlanningDone == true`
- hard timeout 10 分钟兜底

### Step 5: dedupe GPT query 追加

`runSlowPlanning` 在 createMany 前去重：

```ts
const existingQueries = await prisma.searchQuery.findMany({
  where: { taskId },
  select: { query: true }
});
const existingSet = new Set(existingQueries.map(q => q.query.toLowerCase().trim()));
const newGptQueries = gptQueries.filter(
  q => !existingSet.has(q.query.toLowerCase().trim())
);
await prisma.searchQuery.createMany({ data: newGptQueries.map(toRecord) });
```

### Step 6: 失败兜底 + querySource 标记

- slowPlanning 失败 → `aiPlanning.querySource = "lane_k_only"`
- task.inputPayload 更新 profileSignals
- 任务最终状态 paused（不是 failed）

### Step 7: 测试

更新现有测试 + 新增集成测试：

1. **既有测试不破**：`agent-workflow.service.spec.ts` 32 个测试继续通过
2. **新测试**：
   - `runFastPlanning` 单测
   - `runSlowPlanning` 单测
   - `executeBraveSearchPolling` 单测（mock pending queries）
   - 并发集成测试：`brave_search.startedAt < plan_search_queries.completedAt`
   - 失败集成测试：mock plan_search_queries 抛错，Lane K 仍跑完

## 4 个工程坑（Codex 提醒）

| # | 坑 | 兜底方案 |
|---|---|---|
| 1 | taskId 必须先有才能入库 | autonomous path 已经先 create task，OK |
| 2 | pending query 必须原子 claim | `updateMany WHERE id+pending → running`，count 检查 |
| 3 | brave_search 等 GPT 不能无限等 | 收敛条件 + 10min hard timeout |
| 4 | slowPlanning 失败不能拖死任务 | slowPromise.catch + querySource 降级标记 |

## 5 条验收标准

- [ ] `brave_search.startedAt < plan_search_queries.completedAt`（agentStep 时间戳）
- [ ] 前 10-12 条执行的是 Lane K（searchResults 排序 + 时间戳）
- [ ] GPT query 后追加并被同一轮 brave_search 消费（searchResults.createdAt 跨越两段）
- [ ] 没有 query 重复执行（searchResults 表里同一 queryId 不重复）
- [ ] plan_search_queries 失败时 Lane K 仍跑完 + 任务 paused（集成测试 mock）

## 工程量估算

- Step 2: 拆 buildAiPlanningContext — 1.5h
- Step 3: 改 runAutonomousLeadDiscovery — 1.5h
- Step 4: brave_search polling + 原子 claim — 2h
- Step 5: dedupe — 30m
- Step 6: 失败兜底 — 1h
- Step 7: 测试 + 验收 — 1.5h

**合计 8h**，建议拆成 3-4 次会话做：
1. Step 2+3（拆 + 编排）
2. Step 4+5（polling）
3. Step 6+7（兜底 + 测试）

## 风险点

1. **LangGraph 编排**：当前 `runSemiManagedWorkflowToSearchPlan` 把 plan_search_queries 视为同步节点。改并发后，LangGraph 的 step status 写入要小心，避免 brave_search 被标记完成时 plan 还在跑。
2. **任务恢复（recovery）**：服务重启时，`recoverRunningLeadDiscoveryTasks` 当前不区分 fast/slow 阶段。如果重启时 fast 已完成 + slow 在跑，恢复要判断阶段并重新启动 slowPlanning + brave_search polling。
3. **Inline path（test 用）保持不变**：`shouldPlanTaskInline()` 路径继续走旧的串行流程，避免影响测试。
4. **前端轮询**：前端每 N 秒拉 `searchQueries`，新增的 GPT query 会自然出现，不需要前端改。

## 实测目标

| 指标 | 当前 | V1-MVP 目标 |
|---|---|---|
| 用户首批 Brave 结果可见时间 | ~3-5 分钟 | **~30-60 秒** |
| 总任务时间 | ~25-30 分钟 | ~25-28 分钟（搜索阶段不变，省了等待） |
| GPT 总成本 | 不变 | 不变 |
| 候选质量 | 当前水平 | 当前水平（不退化） |

## 下次开工 checklist

1. 先重读这份文档
2. 跑一次基线任务，记录当前耗时和首批结果时间
3. 从 Step 2 开始：先拆 buildAiPlanningContext，跑测试确认现有 32 个测试不破
4. 每 Step 完成后跑 typecheck + 全量测试 + 一个真实任务验证
5. 全部完成后跑 1-2 个真实任务验证 5 条验收标准
