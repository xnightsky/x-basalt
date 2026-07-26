---
timestamp: 2026-07-22T07:41:55Z
sha256: a9ed5e60a7cfc6e118b3cb15c37c8c31713ef6b110cd6f81143207e56229581e
type: guide
title: 配置与基目录 · x-basalt
description: x-basalt 配置文件查找顺序、键说明与 X_BASALT_DIR 基目录
tags:
  - guide
  - config
  - x-basalt
---
# 配置与基目录 · x-basalt

> 本章说明如何把稳定的默认值（Vault 路径、索引路径等）写入配置文件，
> 省去每次传 `--db`/`<vault>` 等重复参数。
>
> 上级索引：[使用指南](usage.md) ·
> 相关章节：[命令参考](commands.md) · [索引与同步](indexing-and-sync.md) · [故障排查](troubleshooting.md)

---

## 1. 为什么要配置文件

配置文件相当于「本机/本项目该怎么跑」的记忆，**不入 git**（`.gitignore` 已排除 `.x-basalt/`）：

```bash
# 没有配置文件时，每次都要重复
x-basalt index ./my-vault --db ./my-vault/.x-basalt/index.db

# 配好 vault + db 后，直接
x-basalt index
```

---

## 2. 文件位置与查找顺序

配置加载使用 **cosmiconfig**，采用 `project` 策略——从当前工作目录**逐级向上**查找，首个命中的文件生效（不合并同级）。查找顺序（优先级从高到低）：

| 优先级 | 路径（相对 cwd 或其上级） | 格式  |
| ------ | ------------------------- | ----- |
| 1      | `.x-basalt/config.yaml`   | YAML  |
| 2      | `.x-basalt/config.yml`    | YAML  |
| 3      | `.x-basalt/config.json5`  | JSON5 |
| 4      | `.x-basalt/config.json`   | JSON5 |
| 5      | `.x-basalt.yaml`          | YAML  |
| 6      | `.x-basalt.yml`           | YAML  |
| 7      | `.x-basalt.json5`         | JSON5 |
| 8      | `.x-basalt.json`          | JSON5 |

**隐藏目录形式（`.x-basalt/config.*`）优先于扁平文件形式（`.x-basalt.*`）**；同形式内 `yaml > yml > json5 > json`。

**全局兜底**：若上溯至根目录仍未命中，则回退到 `~/.x-basalt/config.{yaml,yml,json5,json}`（同扩展名优先级）。项目配置的所有键**覆盖**全局配置对应键；全局独有键保留。

**解析器**：`.yaml`/`.yml` 用 `yaml` 包；`.json5`/`.json` 用 JSON5（支持注释和尾逗号）。

---

## 3. `X_BASALT_DIR` 环境变量

`X_BASALT_DIR` 用于把 `.x-basalt` **基目录整块搬到任意位置**，设置后有两个效果：

1. **项目配置来源**：从 `$X_BASALT_DIR/config.{yaml,yml,json5,json}` 读取，**替代** cwd 向上就近发现。
2. **默认索引路径**：`DEFAULT_DB` 变为 `$X_BASALT_DIR/index.db`（而非 `.x-basalt/index.db`）。

```powershell
# PowerShell（当前会话）
$env:X_BASALT_DIR = "D:\vault-state\.x-basalt"

# PowerShell（永久，用户级）
[Environment]::SetEnvironmentVariable("X_BASALT_DIR", "D:\vault-state\.x-basalt", "User")
```

```bash
# bash / zsh（当前会话）
export X_BASALT_DIR="/home/user/vault-state/.x-basalt"

# bash（永久，写入 ~/.bashrc 或 ~/.zshrc）
echo 'export X_BASALT_DIR="/home/user/vault-state/.x-basalt"' >> ~/.bashrc
```

> `X_BASALT_DIR` 未设时，基目录为当前工作目录下的 `.x-basalt`（相对路径）。

---

## 4. 可配置项

标量键**均可选**、**值须为字符串**（`vault` 额外支持**字符串列表 = 多目录**；未知键与非字符串值静默丢弃）；`pipelines`、`lint`、`profiles` 是**结构化对象**键（分别对应变更编排器、links/lint ignore、自定义 metadata profile；见下）。

| 键          | 对应 CLI 参数                                | 说明                                                                                                                                                                                                                   |
| ----------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault`     | `index`/`scan`/`watch` 的 `[vault...]` 位置参数 | 默认 Vault 根；**支持单目录（字符串）或多目录（字符串列表）**；配好后可省略位置参数。多根索引其并集，主键以各根目录名作命名空间（见 §6.5）                                                                                                                                                                                |
| `db`        | `--db <path>`                                | 默认 SQLite 索引文件路径                                                                                                                                                                                               |
| `skillPath` | 等价 `OBSIDIAN_SKILL_PATH` 环境变量          | 默认 skill 目录                                                                                                                                                                                                        |
| `format`    | `parse --format`                             | 默认输出格式，`json` 或 `yaml`                                                                                                                                                                                         |
| `onChange`  | `watch --on-change`                          | 默认变更命令模板（`{file}` 占位）                                                                                                                                                                                      |
| `pipelines` | `--pipe use=<name>`（run/scan/watch 共用）   | **结构化对象**：命名管道快照（`name → {actions, where, on, paths, concurrency, dryRun}`）。**命令行 `--pipe k=v` 与之一一对应**——命令行是规范落地、配置段是加速。见 [commands.md `run`](commands.md#run--变更编排管道) |
| `lint`      | `links check` / `lint` 共用                  | **结构化对象**：`ignore.{paths,targets,rules}` 屏蔽历史附件 / 生成目录 / 外链，对 links 与 metadata 诊断同样生效。见 [commands.md `links`](commands.md#links--本地链接诊断) |
| `profiles`  | `lint --profile <name>`                      | **结构化对象**：自定义 metadata profile（`name → {extends, required, enums, include}`），**同名覆盖内置**。`extends` 单父继承（子覆盖父、required 并集、enums 只加不减）。见 [commands.md `lint`](commands.md#lint--规则诊断metadata--links) |

---

## 5. 优先级

```
命令行 flag
    ↓（未提供时）
配置文件 config.db
  （来源：X_BASALT_DIR 指定的目录  OR  cwd 向上就近发现）
  （项目配置键覆盖全局配置同名键）
    ↓（config 中也无此键时）
内置默认：$baseDir/index.db
  （baseDir = X_BASALT_DIR ?? ".x-basalt"）
```

以 `db` 为例，完整解析链：

```
--db <path>  ??  config.db  ??  $X_BASALT_DIR/index.db（或 .x-basalt/index.db）
```

`vault` 没有内置默认值——`config.vault` 和位置参数二者均缺时命令报错退出。

---

## 6. 示例

### 6.1 推荐：隐藏目录形式（YAML）

`.x-basalt/config.yaml`：

```yaml
vault: ./my-vault
db: ./.x-basalt/index.db # 可省略（等于默认值）


# skillPath: ./team-skills  # 可选
# format: yaml              # parse 默认 json
# onChange: "echo changed {file}"
```

配好后：

```bash
x-basalt index               # vault 取自配置，db 取默认
x-basalt scan                # 同上，增量扫描
x-basalt query "LIST FROM #project"   # db 取默认，无需 --db
x-basalt watch               # vault + db 均取配置/默认
```

### 6.2 等价的扁平 JSON5（支持注释）

`.x-basalt.json5`：

```json5
{
  vault: "./my-vault",
  // db 省略即用默认 .x-basalt/index.db
  // onChange: "node reindex.js {file}",
}
```

> 隐藏目录形式（`.x-basalt/config.yaml`）优先级高于扁平形式（`.x-basalt.json5`），二者同时存在时取前者。

### 6.3 全局配置（多 Vault 共用 skill 目录）

`~/.x-basalt/config.yaml`：

```yaml
skillPath: /home/user/shared-skills
```

项目内再放 `.x-basalt/config.yaml`（只配 `vault`），两层合并后 `skillPath` 来自全局、`vault` 来自项目。

### 6.4 使用 `X_BASALT_DIR` 指定状态目录

```powershell
# PowerShell：把索引库与配置都放到 D:\basalt-state
$env:X_BASALT_DIR = "D:\basalt-state"
x-basalt index ./my-vault    # 索引写入 D:\basalt-state\index.db；配置从 D:\basalt-state\config.yaml 读
x-basalt query "LIST FROM #project"   # db 默认即 D:\basalt-state\index.db
```

### 6.5 多目录（多 Vault 根）

`vault` 可写成**字符串列表**，索引多个目录的**并集**——主键以**各根目录名**作命名空间（`docs/…`、`notes/…`），互不覆盖，且与根之间的物理距离无关（不退化成近乎绝对的长路径）：

```yaml
vault:
  - ./docs
  - ./notes
```

等价 CLI：`x-basalt index ./docs ./notes`，或重复 `--vault`（`run`/`chat`）。

> **约束**：多根的**目录名（basename）须互不相同**（用作命名空间，冲突即报错）。单目录仍写字符串即可（主键为相对该根的路径，无命名空间前缀，与历史一致）。

---

## 7. 降级行为

配置文件解析失败（YAML/JSON5 语法错误等）时：

- 打印 `⚠ 跳过无法解析的配置文件 <路径>：<原因>`
- 该文件视为空配置（`{}`）继续
- **不中断命令**，CLI 照常以内置默认或 flag 运行

未知键与非字符串值被静默丢弃，不 warn。

---

> 本章对应源码真相源：
> [`src/config.ts`](../../src/config.ts)（cosmiconfig 搜索/加载/合并/白名单）、
> [`src/cli.ts`](../../src/cli.ts)（`BASE_DIR`/`DEFAULT_DB` 与各命令 `flag ?? config.X ?? 默认` 解析）。
