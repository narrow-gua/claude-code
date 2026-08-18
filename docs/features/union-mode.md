# UNION Mode — 多模型权威分级协作（实现规格）

> 状态：设计定稿 / 待实现
> 日期：2026-08-12
> 相关讨论：文本水印、tool 拦截改写（方案 A）、Plan→Implement Union（方案 B）、粗粒度与 Opus 主导落地
> 邻近能力：`COORDINATOR_MODE`、`ULTRAPLAN`、`EnterPlanMode`、AgentTool 子代理、多 Provider（OpenAI/Gemini/Grok）

---

## 0. 一句话

**Union 不是「Claude 永远只写粗 plan」**，而是：

> **可切换的实现权威（谁写最终代码）+ 可升降的产出粒度（L0–L3）+ 硬工具白名单 + 结构化交接。**

默认 system prompt **不大改**；靠 mode/agent 短叠加 + 权限 + handoff 协议落地。

---

## 1. 背景与目标

### 1.1 背景

1. Anthropic 对新 Claude 模型引入**模型级文本水印**（嵌在生成文本中，非客户端 metadata）。客户端无法无损擦除。
2. 本仓库已有多 Provider 与 Agent/Plan 编排能力，适合做**分工**而非假「去水印滤镜」。
3. 粗暴「Claude 只规划、他模写代码」会在 **shader / 数值 / 图形变换** 等任务上严重掉质量——这类任务 **Opus coding 仍应主导落地**。

### 1.2 目标（按优先级）

| 优先级 | 目标 |
|--------|------|
| P0 | 质量：高 coding 敏感任务由强模型（如 Opus）主导核心落地 |
| P0 | 可控：产出粒度 L0–L3，禁止「永远框架 plan」 |
| P1 | 成本：低敏感任务可下放到次级模型（Luna/Terra/GPT…） |
| P1 | 清晰：核心区权威不可被二模语义重写 |
| P2 | 旁路收益：最终落盘正文尽量不经 Claude 时，减弱 Claude 文本水印暴露面（**不保证清除**） |

### 1.3 非目标

- 无损、静默「去除」Claude 统计文本水印
- 每个 `Write`/`Edit` 都过二模润色（方案 A 默认路径）
- 重写整本 `src/constants/prompts.ts` 默认人格
- 替代 `COORDINATOR_MODE` 的多 worker 并行编排（可日后组合，v1 不做）

---

## 2. 方案对比（决策记录）

| | 方案 A：Tool call 拦截 → 二模改写 → 执行 | 方案 B：Union 权威分级 |
|--|--|--|
| 机制 | 执行 Write/Edit 前改写 `input` | 按 L 级决定谁持有写权限与代码权威 |
| 侵入性 | 中（executor 钩子） | 中高（mode + 双角色 + 协议） |
| Edit 风险 | **高**（`old_string` 易被改坏） | 可控（核心由权威模型直接 Edit） |
| Shader/算法 | **差**（最伤质量） | **可指定 Opus-led（L2/L3）** |
| 水印 | 不稳、漏 Bash 旁路 | 仅当落盘不经 Claude 时更干净 |
| 结论 | **不做默认主路径**；最多实验性「仅大文件 Write 文案」 | **采用 B 的分级形态** |

**否决完整 A 的原因**：Edit 语义脆弱、短 diff 改写无意义、算法核被二模「润色」质量崩、Bash 旁路。

---

## 3. 核心概念

### 3.1 实现权威（Authority）

| 角色 | 模型来源（可配置） | 默认可写？ |
|------|-------------------|-----------|
| **Planner** | 主会话模型，通常 Claude/Opus | 仅 L0/L1 时只读；L2/L3 时可写核心 |
| **Implementer** | 次级模型槽（如 GPT/Luna/Terra/OpenAI 兼容） | L0/L1 持有写权限；L2 仅 glue；L3 不参与写 |
| **Verifier** | 脚本优先（`precheck`/test）；可选只读模型 review | 不写业务代码 |

> v1 建议：Planner = 当前 mainLoopModel；Implementer = 独立 `union.implementerModel` 配置。

### 3.2 产出粒度 L0–L3

| Level | 名称 | Planner 产出 | 谁写盘 | 适用 |
|-------|------|--------------|--------|------|
| **L0** | Intent Plan | 目标、文件列表、约束、验收命令 | Implementer | CRUD、搬文件、套路活 |
| **L1** | Thick Plan | L0 + 数据流/不变量/关键公式/风险；可选 hint diff | Implementer | 中等功能、接口对齐 |
| **L2** | Core-led | **核心代码/权威 patch 由 Planner 写出**；另附 glue 清单 | Planner 写 core；Implementer 只做 glue/接线/格式/跑测 | **Shader、变换、数值、协议细节** |
| **L3** | Full Opus | 与单模型主循环相同，Planner 全工具 | 仅 Planner | 高风险/高耦合/用户强制 |

**硬规则：coding 敏感任务默认不得停在 L0。**
Shader / 非显然变换逻辑 → **默认 L2 或 L3**。

### 3.3 核心区（Core Zone）

下列任一命中即视为 core（可配置扩展）：

**路径/扩展名（默认启发式）**

- `*.glsl` `*.hlsl` `*.wgsl` `*.vert` `*.frag` `*.comp` `*.slang` `*.metal`
- 路径含 `shader` `shaders`（大小写不敏感）
- 可选：`*.cu` `*.cuh`（数值/GPU）

**内容标记（权威）**

```text
// @union-core
// @union-core-begin ... // @union-core-end
```

**Plan 字段声明**

```json
"core_files": ["src/foo.frag"],
"core_hunks": [{ "file": "src/foo.frag", "symbol": "mainImage" }]
```

**二模禁令（L2）**：对 core_files / core_hunks / `@union-core` **禁止语义重写**；仅允许用户显式允许的纯格式化（默认建议：core 格式化也跳过）。

---

## 4. 工作流

### 4.1 总览

```text
用户开启 Union（命令/设置/环境变量）
        │
        ▼
┌───────────────────┐
│  Level 判定        │  规则 + 用户覆盖 +（可选）模型自报
│  L0 / L1 / L2 / L3 │
└─────────┬─────────┘
          │
    ┌─────┴──────────────────────┐
    ▼                            ▼
 L0 / L1                      L2 / L3
    │                            │
 Planner 只读工具              Planner 可写（L3 全开；L2 写 core）
 产出 Plan Artifact            产出核心 patch +（L2）glue 清单
    │                            │
    ▼                            ▼
 Implementer 独占 Write/Edit   Implementer 可选：仅 glue / 或跳过
    │                            │
    └────────────┬───────────────┘
                 ▼
         Verify（precheck / 相关 test）
                 │
         失败 → 回 Implementer（机械修复）
              → 仍失败且属算法核 → 升级 L2/L3 交还 Planner
                 │
                 ▼
         （可选）Planner 只读 review diff，不写盘
```

### 4.2 与现有 Plan Mode 的关系

| 能力 | 关系 |
|------|------|
| `EnterPlanMode` / ExitPlan | 可复用「先计划后执行」交互；Union 在执行期再拆权威 |
| `ULTRAPLAN` | 可做 L1 加厚的入口，不替代 L2 |
| `COORDINATOR_MODE` | 多 worker 并行；Union v1 单 implementer 串行，避免状态爆炸 |
| AgentTool Explore | Planner 阶段可只读探索，等同加厚上下文 |

---

## 5. Plan Artifact 协议（v1 schema）

实现时用 JSON（优先）或严格 fenced 块；解析失败 → 要求 Planner 重发，不进入 Implementer。

```json
{
  "union_level": "L0 | L1 | L2 | L3",
  "title": "string",
  "goal": "string",
  "non_goals": ["string"],
  "files_to_touch": ["relative/path"],
  "core_files": ["relative/path"],
  "core_hunks": [
    { "file": "relative/path", "symbol": "optional", "note": "optional" }
  ],
  "steps": ["string"],
  "invariants": ["string"],
  "acceptance": [
    { "type": "command", "run": "bun test path/to/file" },
    { "type": "manual", "check": "画面无接缝" }
  ],
  "risks": ["string"],
  "hint_diffs": [
    {
      "file": "relative/path",
      "authority": "hint | core",
      "unified_diff": "string"
    }
  ],
  "glue_tasks": [
    {
      "description": "注册 pass / 改 CMake",
      "files": ["relative/path"]
    }
  ],
  "context_files": [
    {
      "path": "relative/path",
      "reason": "Implementer 必须阅读"
    }
  ]
}
```

### 字段权威

| 字段 | L0 | L1 | L2 | L3 |
|------|----|----|----|-----|
| `union_level` | 必填 | 必填 | 必填 | 必填 |
| `files_to_touch` / `acceptance` | 必填 | 必填 | 必填 | 建议 |
| `invariants` | 可选 | 建议 | 建议 | 可选 |
| `hint_diffs` | 可选 | 可选 | **core 的 diff 必须 `authority: core`** | 直接落地可无 artifact |
| `glue_tasks` | 可选 | 可选 | L2 建议 | 少用 |
| `context_files` | 建议 | **必填（可自动补全）** | **必填** | 可选 |

**L2 关键**：`authority: core` 的 diff/内容 = 最终真源；Implementer **原样 apply**，不得「重写更优算法」。

---

## 6. 工具白名单（硬约束，优于 prompt 自觉）

### 6.1 Planner

| Level | Read/Grep/Glob | Edit/Write/NotebookEdit | Bash |
|-------|----------------|-------------------------|------|
| L0 | ✅ | ❌ | 只读建议 / 或 ❌ |
| L1 | ✅ | ❌ | 只读建议 / 或 ❌ |
| L2 | ✅ | ✅ **仅 core 路径**（策略可先放宽为全写，靠 review） | ✅ 用于编译相关只读或用户允许 |
| L3 | ✅ | ✅ | ✅ |

v1 务实策略：

- L0/L1：`canUseTool` 拒绝 Write/Edit/NotebookEdit；Bash 可选 deny 或 allowlist（`git status`、`rg` 等）
- L2：允许 Planner 全写（实现简单）；用 post-hoc 检查 + glue 分派二模
  - 进阶：路径级 allow（仅 core_files）
- L3：与主循环相同

### 6.2 Implementer

| Level | 写权限 |
|-------|--------|
| L0/L1 | 全部业务写工具（受全局权限模式约束） |
| L2 | **禁止**修改 `core_files` / `@union-core` 区；允许 glue_tasks 列出的文件 |
| L3 | 不启动 Implementer 写路径 |

### 6.3 明确禁止（任何 Level 的二模）

- 对 core 的「优化/重写/简化数学」
- 静默改 `old_string` 周边以「提高匹配率」而不报告
- 用 Bash `cat >` 绕过 core 禁写（L2 应对 Bash 写 core 路径同样拦截或告警）

---

## 7. Level 判定

### 7.1 优先级（高覆盖低）

1. 用户显式：`/union l2`、`/union l3`、`/union plan-only`（L0/L1）、设置项
2. 会话 sticky：本 task 已升级到 L2 则保持直到 task 结束
3. 启发式路由（见下）
4. 模型自报 `union_level`（可被 1–3 覆盖）
5. 默认：`L1`（可配置为 `L0`）

### 7.2 启发式 → 建议 Level

| 信号 | 建议 |
|------|------|
| shader/图形扩展名或路径 | **L2** |
| 关键词：matrix、NDC、clip space、tone map、SDF、convolve、jacobian、quaternion… | **L2** |
| 用户说「你来写核心/算法/实现细节」 | **L2/L3** |
| 纯文案、README、重命名、加 flag | **L0** |
| 多文件 API 对齐、中等 feature | **L1** |
| 用户说「全部自己搞定」且高风险 | **L3** |

### 7.3 失败升级

```text
Implementer 验收失败
  → 同一 level 机械重试 ≤ N（默认 2）
  → 仍失败：
       若错误触及 core / 数值 / 编译核 → 升 L2（交还 Planner 写核）
       若仅 glue → 保持 L1，收紧 glue 说明
```

---

## 8. 提示词策略（小而硬）

### 8.1 原则

- **不重写**默认 `getSystemPrompt()` 长文
- 使用 `buildEffectiveSystemPrompt` 已有能力：mode/agent 叠加或 `appendSystemPrompt`
- CLAUDE.md / project-instructions **两边共享**
- 质量靠 schema + 工具限制，不靠长篇人格

### 8.2 Planner 叠加（示意）

```text
# Union Mode — Planner
You are the planner/authority selector for Union mode.
At the start of each task, set union_level (L0–L3) per policy.
For shader/math/graphics kernels and non-obvious transform logic,
you MUST choose L2 or L3 and produce concrete core code or authority:core diffs.
Do not stop at framework-only plans when correctness hinges on the algorithm.
Respect tool restrictions for the current level.
Emit a single Plan Artifact matching the Union schema when level is L0–L2.
```

### 8.3 Implementer 叠加（示意）

```text
# Union Mode — Implementer
Implement the Plan Artifact against the provided file contents.
If a hunk or file is marked core / authority:core / @union-core, apply it faithfully.
Do not re-derive or "improve" core math or shaders.
Only perform glue_tasks and non-core edits.
Run acceptance commands; on failure, fix mechanically and report.
```

### 8.4 预计增量

- Planner 叠加：约 0.5–2KB
- Implementer 叠加：约 0.5–1.5KB
- Schema 说明可放 skill/模板文件，避免每轮塞满

---

## 9. 上下文打包（质量关键）

Implementer 请求必须包含：

1. Plan Artifact（全文）
2. `context_files` + `files_to_touch` 的**当前文件内容**（超限则切片 + 行号，优先符号级）
3. 仓库硬约束摘要（可从 CLAUDE.md 已有 project-instructions 继承）
4. 上轮失败时的 **命令输出**（截断）

**禁止**只丢一句「请按 plan 实现」给二模。

自动补全：`context_files` 为空时，用 `files_to_touch` 填充；单文件过大走切片策略（可复用现有 read 截断逻辑）。

---

## 10. 配置与入口（建议）

### 10.1 配置项（settings.json 示意）

```json
{
  "union": {
    "enabled": false,
    "defaultLevel": "L1",
    "implementerProvider": "openai",
    "implementerModel": "gpt-…",
    "maxImplementerRetries": 2,
    "coreGlobs": ["**/*.{glsl,hlsl,wgsl,vert,frag,comp,slang,metal}"],
    "corePathSubstrings": ["shader"],
    "allowBashWriteInL0L1": false,
    "plannerCanWriteOutsideCoreInL2": true
  }
}
```

### 10.2 用户命令（建议）

| 命令 | 行为 |
|------|------|
| `/union` | 开/关或显示状态 |
| `/union on` `off` | 开关 |
| `/union l0`…`l3` | 本 task 强制 level |
| `/union plan-only` | 强制只读规划到出 artifact |
| `/union implement` | 对当前 artifact 触发 Implementer |
| `/union status` | level、权威、core 列表、重试次数 |

### 10.3 Feature flag

建议：`FEATURE_UNION_MODE` + 设置/环境变量双开（对齐 coordinator 模式习惯）。

---

## 11. 与代码库挂载点（实现地图）

| 关注点 | 候选位置 |
|--------|----------|
| Mode 检测 | 新建 `src/union/` 或 `src/utils/union/`（对齐 `src/coordinator/`） |
| System 叠加 | `buildEffectiveSystemPrompt` / QueryEngine 组装处 |
| 工具拦截 | `canUseTool` 管道、`permissions` |
| 主循环 | `src/query.ts`、`src/QueryEngine.ts` |
| 次级模型调用 | 现有 provider：`src/services/api/openai|gemini|grok`；或 `sideQuery` / forked agent |
| Plan 解析 | 新模块 `planArtifact.ts` |
| 上下文打包 | 复用 FileRead / attachments 模式 |
| UI 状态 | AppState + PromptInput 状态条（当前 level/authority） |
| 命令 | `src/commands/union/` |
| 测试 | `src/union/__tests__/`、集成测 handoff 与 core 禁写 |

**参考实现风格**：`docs/features/coordinator-mode.md`、`src/coordinator/coordinatorMode.ts`。

---

## 12. 分阶段实现计划

### Phase 0 — 规格冻结（本文档）✅

- [x] A/B 决策、L0–L3、core 规则、非目标

### Phase 1 — MVP（可演示）

1. Feature flag + settings 骨架
2. `/union` 开关与强制 level
3. L0/L1：Planner 禁写 + Plan Artifact 解析
4. Implementer 单次调用：打包 plan + 文件 → 次级模型 → 主会话 tool 执行 **或** implementer 侧工具循环（二选一，见 12.1）
5. acceptance 命令执行与失败回传 1～2 次
6. 单元测试：schema 解析、禁写、level 启发式

**MVP 不做**：路径级 L2 精细 ACL、Bash 深度拦截、UI 炫技。

### Phase 1.5 — Implementer 执行模型选择

| 选项 | 描述 | 推荐 |
|------|------|------|
| **I-A** 次级模型只吐 patch，主进程 apply | 实现简单，权限复用主会话 | MVP 推荐 |
| **I-B** 次级模型独立 tool loop | 更像真 agent，状态/权限双份 | Phase 2 |

MVP 选 **I-A**：次级模型返回 `authority` 标记的 unified diff 或 Edit 列表，由**主进程**校验 core 规则后执行现有 FileEdit/FileWrite。

### Phase 2 — L2 Opus-led

1. L2 允许 Planner 写 core
2. Plan 中 `authority: core` 与 glue 分离
3. Implementer 禁碰 core_files
4. 失败升级 L1→L2
5. `@union-core` 标记支持

### Phase 3 — 体验与硬化

1. 状态条、level 切换 UX
2. Bash 写 core 检测
3. 与 ULTRAPLAN / PlanMode 入口打通
4. 可选 Planner 只读 review
5. 遥测（无 PII）：level 分布、升级次数、acceptance 通过率

### Phase 4 — 可选实验

- 非 core 长文 Write 的「二模转述」（**显式 opt-in**，非默认）
- Coordinator × Union 组合

---

## 13. 质量护栏清单（验收标准）

实现完成时应对齐：

1. L0/L1 下 Planner 的 Write/Edit 被**硬拒绝**（测试覆盖）
2. L2 下 core 文件不被 Implementer 语义修改（测试覆盖）
3. Shader 路径启发式默认 L2（测试覆盖）
4. Implementer 输入含文件正文，而非仅 plan 摘要（集成断言）
5. acceptance 失败会回传 stdout/stderr 截断（测试或手工脚本）
6. 不修改默认 prompts 静态区大段；仅叠加短文（code review 检查）
7. `bun run precheck` 通过

### 质量反模式（禁止合入）

- 每个 Edit 默认二模 rewrite
- Claude 框架 plan + 二模重写 shader kernel
- 无 schema 的自由聊天交接
- 宣称「已去除水印」

---

## 14. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 双模型延迟/成本 | 默认 L1；小改动允许用户 `/union off`；I-A 少一轮 tool 协商 |
| Plan 过粗 | 强制字段 + shader→L2；用户可 `/union l2` |
| Diff apply 失败 | 带上下文行号；失败回 Planner/Implementer 明确错误 |
| 权限双标准 | MVP 写操作只走主进程 canUseTool |
| 与 watermark 预期不符 | 文档写明：仅降低暴露面，非清除 |

---

## 15. 测试计划（初稿）

| 用例 | 期望 |
|------|------|
| L0 plan 缺 `acceptance` | 解析失败，不调用 implementer |
| L1 Planner 调 Edit | canUseTool deny |
| 路径 `foo.frag` 无覆盖 | 建议 level = L2 |
| L2 core diff + glue | Implementer 只能改 glue 文件 |
| Implementer 尝试改 core | 拒绝并记录 |
| acceptance 第一次失败 | 重试带日志；超过 N 升级或停止 |
| Union off | 行为与现网一致 |

---

## 16. 文档与用户沟通口径

- Union = **权威与粒度控制**，不是去水印产品
- 高难 coding：Opus **应当**写核心
- 二模：glue、套路实现、执行与修补
- 水印：若最终字节来自 Claude，仍可能带模型级信号

---

## 17. 决策摘要（给排期用）

| 决策 | 选择 |
|------|------|
| 主方案 | B 分级 Union，不做完整 A |
| 粒度 | L0–L3，可强制/可升级 |
| Shader 等 | 默认 L2/L3，Opus 主导核心落地 |
| 提示词 | 短叠加，不大改默认 system |
| 二模执行 MVP | I-A 出 diff，主进程 apply |
| Core 保护 | plan 字段 + globs + 可选标记 |
| 与 Coordinator | v1 独立，不混合 |

---

## 18. 建议排期切片（工程任务包）

可直接拆 issue/PR：

1. **union-skeleton**：flag、settings 类型、`isUnionMode()`
2. **union-level**：启发式 + 强制覆盖 + 单测
3. **union-plan-schema**：zod/手动解析 + 单测
4. **union-can-use-tool**：L0/L1 禁写
5. **union-commands**：`/union` 族
6. **union-implementer-ia**：打包上下文 + 调次级模型 + apply diff
7. **union-accept**：跑 acceptance + retry
8. **union-l2-core**：core 权威与禁写
9. **union-upgrade**：失败升级
10. **union-docs-ux**：状态展示与用户文档

---

## 19. 参考路径（本仓库）

- System 组装：`src/constants/prompts.ts`、`src/utils/systemPrompt.ts`、`src/utils/queryContext.ts`、`docs/context/system-prompt.mdx`
- 主循环：`src/query.ts`、`src/QueryEngine.ts`
- 权限：`src/utils/permissions/`
- Coordinator：`src/coordinator/coordinatorMode.ts`、`docs/features/coordinator-mode.md`
- Providers：`src/services/api/openai|gemini|grok/`、`src/utils/model/providers.ts`
- Plan：`EnterPlanMode` 工具、`docs/features/ultraplan.md`

---

## 20. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-12 | 初版：汇总会话结论，供实现排期 |
