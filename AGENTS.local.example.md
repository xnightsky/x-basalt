# AGENTS.local.md · x-basalt（示例 · 入仓）

> 本文件是**可入仓的示例模板**；实际使用的 `AGENTS.local.md` **不入仓**（见 `.gitignore`）。
>
> **初始化**：`cp AGENTS.local.example.md AGENTS.local.md`，再按需改本机内容。
> 与 `AGENTS.md` 并列；会话启动时若存在 `AGENTS.local.md` 则一并读取。
>
> **放什么**：本机路径、个人工作习惯、**x-basalt CLI 选用**（全局 vs 开发态）、临时实验性指令、本会话授权等**不应污染共享规则**的内容。
> **不放什么**：项目硬约束、模块边界、测试/提交规范等——仍以 `AGENTS.md` / `AGENTS.ai.md` 为准；本地规则不得与之冲突。

## x-basalt CLI 与 docs 自管理

- **若本机存在全局 `x-basalt`**（`Get-Command x-basalt` / `command -v x-basalt` 命中），维护 `docs/` 元数据时**一律用全局 CLI**，不用 `pnpm cli --`。
- **否则**兜底：`pnpm cli -- <子命令>`（开发态 tsx，改源码后无需 `build`）。
- 流程对齐 `AGENTS.md`「Docs 维护 · 文档元数据自举」：先 `meta profile show llm-wiki` 读规范，再 `meta apply llm-wiki <doc> --set …` 补 frontmatter；机械字段由 CLI 填，语义字段经 `--set` 补。

```powershell
# 本机探测（PowerShell）
if (Get-Command x-basalt -ErrorAction SilentlyContinue) { $XB = "x-basalt" } else { $XB = "pnpm cli --" }

# 示例：docs 新增/重写后
& $XB meta profile show llm-wiki
& $XB meta apply llm-wiki docs/guides/foo.md --set type=guide --set title="…" --set description="…" --set tags=guide,docs
```

## 本机环境

- （示例）全局 CLI：已安装（`npm link` / `pnpm link --global`）→ docs 自管理优先 `x-basalt`
- （示例）默认 vault：`./tests/fixtures/sample-vault`
- （示例）Node：`24.x`（via fnm / nvm）

## 个人工作偏好

- （示例）调试时优先：`pnpm run typecheck` → 受影响测试 → `pnpm run build`
- （示例）本会话授权 AI 本地 commit：否（默认；需授权时在此写明）

## 临时 / 实验

- （示例）当前分支专注 parser wikilink 锚点；query 模块勿动
