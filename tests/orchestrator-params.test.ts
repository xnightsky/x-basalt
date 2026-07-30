import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PIPE_KEYS,
  resolvePipelineParams,
  splitTopLevel,
  toConcurrency,
  toDebounce,
  toEnum,
  toEventTypes,
  toOnBusy,
} from "../src/orchestrator/params.js";
import type { PipelineConfig } from "../src/orchestrator/types.js";

// === 管道参数解析/校验（spec §8.1「管道 = 一组参数」）===
// 计划：docs/plans/2026-07-30-pipe-closure.md PC-1/PC-2。
// 这层是命令行 `--pipe k=v` 与配置段 `pipelines.<name>` 的**共用**入口，
// 故用例按「切分 / 字段校验 / 组装」三段重测：非法值必须声明期报错，不静默忽略、不静默降级。

// --- PC-1a splitTopLevel：括号感知逗号切分 ---

test("PC-1a Given 顶层逗号 When splitTopLevel Then 逐项切分并 trim", () => {
  assert.deepEqual(splitTopLevel("index, normalize , parse"), ["index", "normalize", "parse"]);
});

test("PC-1a Given 方括号内含逗号 When splitTopLevel Then 括号内不切（set 列表值保命）", () => {
  assert.deepEqual(splitTopLevel("set tags=[a, b],index"), ["set tags=[a, b]", "index"]);
});

test("PC-1a Given 花括号 glob 内含逗号 When splitTopLevel Then 括号内不切（brace 展开保命）", () => {
  assert.deepEqual(splitTopLevel("**/*.{md,txt},pkm/**"), ["**/*.{md,txt}", "pkm/**"]);
});

test("PC-1a Given 圆括号内含逗号 When splitTopLevel Then 括号内不切", () => {
  assert.deepEqual(splitTopLevel("f(a,b),g"), ["f(a,b)", "g"]);
});

test("PC-1a Given 嵌套括号 When splitTopLevel Then 按深度归零处切", () => {
  assert.deepEqual(splitTopLevel("set k=[a,{b,c}],index"), ["set k=[a,{b,c}]", "index"]);
});

test("PC-1a Given 未闭合括号 When splitTopLevel Then 整串作一个 token（错误交下游报）", () => {
  assert.deepEqual(splitTopLevel("set k=[a,b"), ["set k=[a,b"]);
});

test("PC-1a Given 空段与纯空白段 When splitTopLevel Then 丢弃", () => {
  assert.deepEqual(splitTopLevel("index,, ,normalize"), ["index", "normalize"]);
  assert.deepEqual(splitTopLevel(""), []);
});

// --- PC-1b 字段级校验器 ---

test("PC-1b Given on 为逗号串或数组 When toEventTypes Then 都归一为 EventType[]", () => {
  assert.deepEqual(toEventTypes("add, change", "--pipe on"), ["add", "change"]);
  assert.deepEqual(toEventTypes(["add", "unlink"], "pipelines.m.on"), ["add", "unlink"]);
  assert.equal(toEventTypes(undefined, "--pipe on"), undefined);
});

test("PC-1b Given on 含非法事件类型 When toEventTypes Then 报错并带来源与合法值", () => {
  assert.throws(() => toEventTypes("add,modified", "--pipe on"), /--pipe on.*modified.*add/s);
});

test("PC-1b Given concurrency 合法 When toConcurrency Then 取数字；非正整数报错", () => {
  assert.equal(toConcurrency("8", "--pipe concurrency"), 8);
  assert.equal(toConcurrency(4, "pipelines.m.concurrency"), 4);
  assert.equal(toConcurrency(undefined, "--pipe concurrency"), undefined);
  assert.throws(() => toConcurrency("abc", "--pipe concurrency"), /concurrency/);
  assert.throws(() => toConcurrency("0", "--pipe concurrency"), /concurrency/);
  assert.throws(() => toConcurrency("-1", "--pipe concurrency"), /concurrency/);
  assert.throws(() => toConcurrency("1.5", "--pipe concurrency"), /concurrency/);
});

test("PC-1b Given debounce 为 wait,maxWait 串或对象 When toDebounce Then 都归一", () => {
  assert.deepEqual(toDebounce("300,3000", "--pipe debounce"), { wait: 300, maxWait: 3000 });
  assert.deepEqual(toDebounce({ wait: 50, maxWait: 500 }, "pipelines.m.debounce"), {
    wait: 50,
    maxWait: 500,
  });
  assert.equal(toDebounce(undefined, "--pipe debounce"), undefined);
});

test("PC-1b Given debounce 非法 When toDebounce Then 报错（缺项/非数/负数/wait>maxWait）", () => {
  assert.throws(() => toDebounce("300", "--pipe debounce"), /debounce/);
  assert.throws(() => toDebounce("a,b", "--pipe debounce"), /debounce/);
  assert.throws(() => toDebounce("-1,100", "--pipe debounce"), /debounce/);
  assert.throws(() => toDebounce("3000,300", "--pipe debounce"), /debounce/);
  assert.throws(() => toDebounce({ wait: 1 }, "pipelines.m.debounce"), /debounce/);
});

test("PC-1b Given 枚举值 When toEnum Then 合法透传、非法报错并列可选值", () => {
  assert.equal(toEnum("skip", ["skip", "overwrite", "merge"], "--pipe if-exists"), "skip");
  assert.equal(toEnum(undefined, ["skip"], "--pipe if-exists"), undefined);
  assert.throws(
    () => toEnum("nope", ["skip", "overwrite", "merge"], "--pipe if-exists"),
    /--pipe if-exists.*skip.*overwrite.*merge/s,
  );
});

test("PC-1b Given on-busy=queue When toOnBusy Then 通过；restart/ignore 报「尚未实现」而非静默降级", () => {
  assert.equal(toOnBusy("queue", "--pipe on-busy"), "queue");
  assert.equal(toOnBusy(undefined, "--pipe on-busy"), undefined);
  assert.throws(() => toOnBusy("restart", "--pipe on-busy"), /尚未实现/);
  assert.throws(() => toOnBusy("ignore", "--pipe on-busy"), /尚未实现/);
  assert.throws(() => toOnBusy("nope", "--pipe on-busy"), /queue/);
});

// --- PC-1c/PC-2a resolvePipelineParams：组装 ---

const BASE: Record<string, PipelineConfig> = {
  maintain: {
    actions: ["index", "normalize"],
    where: "contains(file.tags, 'pkm')",
    on: ["add", "change"],
    paths: ["pkm/**"],
    debounce: { wait: 300, maxWait: 3000 },
    concurrency: 4,
    onBusy: "queue",
    onError: "continue",
    dryRun: true,
    ifExists: "skip",
  },
};

test("PC-1c Given 纯内联 actions When resolvePipelineParams Then 自包含产出（不依赖配置）", () => {
  const p = resolvePipelineParams(["actions=index,normalize"], { apply: false });
  assert.deepEqual(p.actions, ["index", "normalize"]);
  assert.equal(p.dryRun, true); // 默认预览
});

test("PC-1c Given use=<name> When resolvePipelineParams Then 加载配置基底全字段", () => {
  const p = resolvePipelineParams(["use=maintain"], { apply: false, pipelines: BASE });
  assert.deepEqual(p.actions, ["index", "normalize"]);
  assert.equal(p.where, "contains(file.tags, 'pkm')");
  assert.deepEqual(p.on, ["add", "change"]);
  assert.deepEqual(p.paths, ["pkm/**"]);
  assert.deepEqual(p.debounce, { wait: 300, maxWait: 3000 });
  assert.equal(p.concurrency, 4);
  assert.equal(p.onError, "continue");
  assert.equal(p.onBusy, "queue"); // 曾被静默丢弃（PC-1 修）
  assert.equal(p.ifExists, "skip");
});

test("PC-1c Given use + 覆盖项 When resolvePipelineParams Then 命令行覆盖基底", () => {
  const p = resolvePipelineParams(["use=maintain", "concurrency=8", "on=unlink"], {
    apply: false,
    pipelines: BASE,
  });
  assert.equal(p.concurrency, 8);
  assert.deepEqual(p.on, ["unlink"]);
  assert.deepEqual(p.actions, ["index", "normalize"]); // 未覆盖的沿用基底
});

test("PC-2a Given --pipe debounce= 内联 When resolvePipelineParams Then 覆盖基底（曾只能走配置）", () => {
  const p = resolvePipelineParams(["use=maintain", "debounce=50,500"], {
    apply: false,
    pipelines: BASE,
  });
  assert.deepEqual(p.debounce, { wait: 50, maxWait: 500 });
});

test("PC-2a Given --pipe on-error= 内联 When resolvePipelineParams Then 生效", () => {
  const p = resolvePipelineParams(["actions=index", "on-error=stop"], { apply: false });
  assert.equal(p.onError, "stop");
});

test("PC-1c Given --apply When resolvePipelineParams Then dryRun=false（运行时闸覆盖管道定义）", () => {
  assert.equal(resolvePipelineParams(["actions=index"], { apply: true }).dryRun, false);
  assert.equal(
    resolvePipelineParams(["use=maintain"], { apply: true, pipelines: BASE }).dryRun,
    false,
  );
});

test("PC-1c Given 缺 actions When resolvePipelineParams Then 报错并指路两种写法", () => {
  assert.throws(() => resolvePipelineParams([], { apply: false }), /actions|use/);
});

test("PC-1c Given use=未知管道 When resolvePipelineParams Then 报错并列已知名", () => {
  assert.throws(
    () => resolvePipelineParams(["use=nope"], { apply: false, pipelines: BASE }),
    /nope.*maintain/s,
  );
});

test("PC-1c Given 未知 --pipe key（拼错）When resolvePipelineParams Then 报错并列已知 key（不静默丢过滤条件）", () => {
  assert.throws(
    () => resolvePipelineParams(["actions=index", "wehre=LIST"], { apply: false }),
    /wehre.*where/s,
  );
});

test("PC-1c Given 非 key=value 形态 When resolvePipelineParams Then 报错", () => {
  assert.throws(() => resolvePipelineParams(["actions"], { apply: false }), /key=value/);
  assert.throws(() => resolvePipelineParams(["=index"], { apply: false }), /key=value/);
});

test("PC-1c Given actions 含 set 列表值 When resolvePipelineParams Then 括号内逗号不被切碎", () => {
  const p = resolvePipelineParams(["actions=set tags=[a, b],index"], { apply: false });
  assert.deepEqual(p.actions, ["set tags=[a, b]", "index"]);
});

test("PC-1c Given PIPE_KEYS When 对照配置段字段 Then 一一对应（use 为引用入口、dryRun 由 --apply 承载）", () => {
  // 不变量：新增管道字段必须同时补命令行 key 与配置段 key，否则一侧静默丢参数。
  assert.deepEqual([...PIPE_KEYS].toSorted(), [
    "actions",
    "concurrency",
    "debounce",
    "if-exists",
    "on",
    "on-busy",
    "on-error",
    "paths",
    "use",
    "where",
  ]);
});
