// A small PromQL evaluator, enough for the panel queries in dragonite.ts when
// Zapdos is not configured and the samples live in memory
// (local-metrics.ts). Supported: selectors with =, !=, =~, !~ matchers and
// [range]; rate, increase, avg/min/max_over_time, timestamp, scalar, time,
// round, clamp_min, clamp_max; sum/min/max/avg/count with by/without; + - * / between vectors
// (one-to-one on all labels) and scalars; comparison filters (> < >= <= == !=).

export type Labels = Record<string, string>;

export interface Matcher {
  label: string;
  op: "=" | "!=" | "=~" | "!~";
  value: string;
}

/** What a store must provide: series matching a selector, and their samples. */
export interface SeriesSource {
  select(matchers: Matcher[]): StoredSeries[];
}

export interface StoredSeries {
  labels: Labels;
  /** Index of the newest sample at or before `t` (ms), or -1. */
  indexAt(t: number): number;
  time(i: number): number;
  value(i: number): number;
}

type Node =
  | { t: "num"; v: number }
  | { t: "sel"; matchers: Matcher[]; rangeMs?: number }
  | { t: "call"; fn: string; args: Node[] }
  | { t: "agg"; op: string; by?: string[]; without?: string[]; expr: Node }
  | { t: "bin"; op: string; lhs: Node; rhs: Node }
  | { t: "neg"; expr: Node };

// ---------- parsing ----------

const DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|y)/;
const UNIT: Record<string, number> = { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5, y: 31536e6 };

export function parseDurationMs(s: string): number {
  let rest = s.trim();
  let total = 0;
  while (rest) {
    const m = DURATION.exec(rest);
    if (!m) throw new Error(`invalid duration: ${s}`);
    total += Number(m[1]) * UNIT[m[2]];
    rest = rest.slice(m[0].length);
  }
  return total;
}

type Tok = { k: "num" | "str" | "id" | "op" | "dur"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "[") {
      const j = src.indexOf("]", i);
      if (j < 0) throw new Error("missing ]");
      out.push({ k: "dur", v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) {
          const n = src[j + 1];
          s += n === "n" ? "\n" : n === "t" ? "\t" : n;
          j += 2;
        } else s += src[j++];
      }
      out.push({ k: "str", v: s });
      i = j + 1;
      continue;
    }
    const num = /^\d+(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) {
      out.push({ k: "num", v: num[0] });
      i += num[0].length;
      continue;
    }
    const id = /^[a-zA-Z_:][a-zA-Z0-9_:]*/.exec(src.slice(i));
    if (id) {
      out.push({ k: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    const op = /^(=~|!~|!=|==|>=|<=|[-+*/%^(){},=<>])/.exec(src.slice(i));
    if (op) {
      out.push({ k: "op", v: op[0] });
      i += op[0].length;
      continue;
    }
    throw new Error(`unexpected character in query: ${c}`);
  }
  return out;
}

const AGGS = new Set(["sum", "min", "max", "avg", "count"]);
const CMP = new Set([">", "<", ">=", "<=", "==", "!="]);

export function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => toks[p]?.k === "op" && toks[p].v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`expected "${v}" in query`);
    p++;
  };
  const labelList = () => {
    expect("(");
    const ls: string[] = [];
    while (!isOp(")")) {
      const t = toks[p++];
      if (t?.k !== "id") throw new Error("expected a label");
      ls.push(t.v);
      if (isOp(",")) p++;
    }
    expect(")");
    return ls;
  };
  const matchers = (): Matcher[] => {
    expect("{");
    const ms: Matcher[] = [];
    while (!isOp("}")) {
      const l = toks[p++];
      const o = toks[p++];
      const v = toks[p++];
      if (l?.k !== "id" || o?.k !== "op" || v?.k !== "str") throw new Error("invalid selector");
      ms.push({ label: l.v, op: o.v as Matcher["op"], value: v.v });
      if (isOp(",")) p++;
    }
    expect("}");
    return ms;
  };

  const primary = (): Node => {
    const t = peek();
    if (!t) throw new Error("consulta incompleta");
    if (t.k === "num") {
      p++;
      return { t: "num", v: Number(t.v) };
    }
    if (isOp("(")) {
      p++;
      const e = expr(0);
      expect(")");
      return e;
    }
    if (isOp("-")) {
      p++;
      return { t: "neg", expr: primary() };
    }
    if (isOp("{")) return withRange({ t: "sel", matchers: matchers() });
    if (t.k === "id") {
      p++;
      if (AGGS.has(t.v) && (isOp("(") || peek()?.v === "by" || peek()?.v === "without")) {
        let by: string[] | undefined;
        let without: string[] | undefined;
        const mod = () => {
          if (peek()?.v === "by") {
            p++;
            by = labelList();
          } else if (peek()?.v === "without") {
            p++;
            without = labelList();
          }
        };
        mod();
        expect("(");
        const e = expr(0);
        expect(")");
        mod();
        return { t: "agg", op: t.v, by, without, expr: e };
      }
      if (isOp("(")) {
        p++;
        const args: Node[] = [];
        while (!isOp(")")) {
          args.push(expr(0));
          if (isOp(",")) p++;
        }
        expect(")");
        return { t: "call", fn: t.v, args };
      }
      const ms: Matcher[] = [{ label: "__name__", op: "=", value: t.v }];
      if (isOp("{")) ms.push(...matchers());
      return withRange({ t: "sel", matchers: ms });
    }
    throw new Error(`unexpected "${t.v}" in query`);
  };
  const withRange = (n: Node & { t: "sel" }): Node => {
    if (peek()?.k === "dur") n.rangeMs = parseDurationMs(toks[p++].v);
    return n;
  };
  const PREC: Record<string, number> = { ">": 1, "<": 1, ">=": 1, "<=": 1, "==": 1, "!=": 1, "+": 2, "-": 2, "*": 3, "/": 3, "%": 3 };
  const expr = (min: number): Node => {
    let lhs = primary();
    while (peek()?.k === "op" && PREC[peek().v] && PREC[peek().v] > min) {
      const op = toks[p++].v;
      if (peek()?.v === "bool") p++;
      const rhs = expr(PREC[op]);
      lhs = { t: "bin", op, lhs, rhs };
    }
    return lhs;
  };
  const root = expr(0);
  if (p < toks.length) throw new Error(`trailing "${toks[p].v}" in query`);
  return root;
}

// ---------- evaluation ----------

type Sample = { labels: Labels; v: number };
type Val = { k: "scalar"; v: number } | { k: "vector"; s: Sample[] };

const LOOKBACK_MS = 5 * 60_000;

const withoutName = (l: Labels) => {
  const { __name__, ...rest } = l;
  return rest;
};
const keyOf = (l: Labels) =>
  Object.keys(l)
    .sort()
    .map((k) => `${k}\u0000${l[k]}`)
    .join("\u0001");

function rangeFn(fn: string, s: StoredSeries, t: number, rangeMs: number): number | undefined {
  const last = s.indexAt(t);
  if (last < 0) return undefined;
  const from = t - rangeMs;
  // Samples inside (t - range, t], and the one just before for counters.
  let first = last;
  while (first - 1 >= 0 && s.time(first - 1) > from) first--;
  if (s.time(last) <= from) return undefined;
  const pts: number[] = [];
  for (let i = first; i <= last; i++) {
    const v = s.value(i);
    if (Number.isFinite(v)) pts.push(v);
  }
  if (!pts.length) return undefined;
  if (fn === "avg_over_time") return pts.reduce((a, b) => a + b, 0) / pts.length;
  if (fn === "max_over_time") return Math.max(...pts);
  if (fn === "min_over_time") return Math.min(...pts);
  // increase / rate: sum of deltas, a drop meaning the counter restarted.
  let prev: number | undefined;
  if (first - 1 >= 0 && s.time(first - 1) > from - rangeMs) {
    const v = s.value(first - 1);
    if (Number.isFinite(v)) prev = v;
  }
  let inc = 0;
  let base = prev ?? pts[0];
  for (const v of prev === undefined ? pts.slice(1) : pts) {
    inc += v >= base ? v - base : v;
    base = v;
  }
  return fn === "rate" ? inc / (rangeMs / 1000) : inc;
}

export function evaluate(node: Node, src: SeriesSource, t: number): Val {
  switch (node.t) {
    case "num":
      return { k: "scalar", v: node.v };
    case "neg": {
      const v = evaluate(node.expr, src, t);
      return v.k === "scalar" ? { k: "scalar", v: -v.v } : { k: "vector", s: v.s.map((x) => ({ labels: withoutName(x.labels), v: -x.v })) };
    }
    case "sel": {
      if (node.rangeMs) throw new Error("a range [..] can only appear inside a function");
      const out: Sample[] = [];
      for (const s of src.select(node.matchers)) {
        const i = s.indexAt(t);
        if (i < 0 || t - s.time(i) > LOOKBACK_MS) continue;
        const v = s.value(i);
        if (Number.isFinite(v)) out.push({ labels: s.labels, v });
      }
      return { k: "vector", s: out };
    }
    case "call": {
      const fn = node.fn;
      if (fn === "time") return { k: "scalar", v: t / 1000 };
      if (["rate", "increase", "avg_over_time", "max_over_time", "min_over_time"].includes(fn)) {
        const arg = node.args[0];
        if (arg?.t !== "sel" || !arg.rangeMs) throw new Error(`${fn} needs a selector with a [range]`);
        const out: Sample[] = [];
        for (const s of src.select(arg.matchers)) {
          const v = rangeFn(fn, s, t, arg.rangeMs);
          if (v !== undefined) out.push({ labels: withoutName(s.labels), v });
        }
        return { k: "vector", s: out };
      }
      if (fn === "timestamp") {
        const arg = node.args[0];
        if (arg?.t !== "sel") throw new Error("timestamp needs a selector");
        const out: Sample[] = [];
        for (const s of src.select(arg.matchers)) {
          const i = s.indexAt(t);
          if (i >= 0 && t - s.time(i) <= LOOKBACK_MS) out.push({ labels: withoutName(s.labels), v: s.time(i) / 1000 });
        }
        return { k: "vector", s: out };
      }
      const v = evaluate(node.args[0], src, t);
      if (fn === "scalar") return { k: "scalar", v: v.k === "vector" ? (v.s.length === 1 ? v.s[0].v : NaN) : v.v };
      if (fn === "round" && v.k === "vector") return { k: "vector", s: v.s.map((x) => ({ labels: withoutName(x.labels), v: Math.round(x.v) })) };
      if ((fn === "clamp_min" || fn === "clamp_max") && v.k === "vector") {
        const lim = evaluate(node.args[1], src, t);
        if (lim?.k !== "scalar") throw new Error(`${fn} needs a number`);
        const f = fn === "clamp_min" ? Math.max : Math.min;
        return { k: "vector", s: v.s.map((x) => ({ labels: withoutName(x.labels), v: f(x.v, lim.v) })) };
      }
      throw new Error(`unsupported function: ${fn}`);
    }
    case "agg": {
      const v = evaluate(node.expr, src, t);
      if (v.k !== "vector") throw new Error(`${node.op} needs a vector`);
      const groups = new Map<string, { labels: Labels; vs: number[] }>();
      for (const x of v.s) {
        const base = withoutName(x.labels);
        const labels: Labels = {};
        if (node.by) for (const l of node.by) if (base[l] !== undefined) labels[l] = base[l];
        if (node.without) {
          for (const [k, val] of Object.entries(base)) if (!node.without.includes(k)) labels[k] = val;
        }
        const key = keyOf(labels);
        const g = groups.get(key) ?? { labels, vs: [] };
        g.vs.push(x.v);
        groups.set(key, g);
      }
      const reduce = (vs: number[]) => {
        switch (node.op) {
          case "sum":
            return vs.reduce((a, b) => a + b, 0);
          case "min":
            return Math.min(...vs);
          case "max":
            return Math.max(...vs);
          case "avg":
            return vs.reduce((a, b) => a + b, 0) / vs.length;
          default:
            return vs.length;
        }
      };
      return { k: "vector", s: [...groups.values()].map((g) => ({ labels: g.labels, v: reduce(g.vs) })) };
    }
    case "bin": {
      const a = evaluate(node.lhs, src, t);
      const b = evaluate(node.rhs, src, t);
      const cmp = CMP.has(node.op);
      const apply = (x: number, y: number) => {
        switch (node.op) {
          case "+":
            return x + y;
          case "-":
            return x - y;
          case "*":
            return x * y;
          case "/":
            return x / y;
          case "%":
            return x % y;
          case ">":
            return x > y ? 1 : 0;
          case "<":
            return x < y ? 1 : 0;
          case ">=":
            return x >= y ? 1 : 0;
          case "<=":
            return x <= y ? 1 : 0;
          case "==":
            return x === y ? 1 : 0;
          default:
            return x !== y ? 1 : 0;
        }
      };
      if (a.k === "scalar" && b.k === "scalar") return { k: "scalar", v: apply(a.v, b.v) };
      if (a.k === "vector" && b.k === "scalar") {
        return {
          k: "vector",
          s: cmp
            ? a.s.filter((x) => apply(x.v, b.v))
            : a.s.map((x) => ({ labels: withoutName(x.labels), v: apply(x.v, b.v) })),
        };
      }
      if (a.k === "scalar" && b.k === "vector") {
        return {
          k: "vector",
          s: cmp
            ? b.s.filter((x) => apply(a.v, x.v))
            : b.s.map((x) => ({ labels: withoutName(x.labels), v: apply(a.v, x.v) })),
        };
      }
      // Vector with vector: one-to-one on every label but the metric name.
      const right = new Map((b as { s: Sample[] }).s.map((x) => [keyOf(withoutName(x.labels)), x.v]));
      const out: Sample[] = [];
      for (const x of (a as { s: Sample[] }).s) {
        const y = right.get(keyOf(withoutName(x.labels)));
        if (y === undefined) continue;
        if (cmp) {
          if (apply(x.v, y)) out.push(x);
        } else out.push({ labels: withoutName(x.labels), v: apply(x.v, y) });
      }
      return { k: "vector", s: out };
    }
  }
}

const regexCache = new Map<string, RegExp>();
const anchored = (src: string) => {
  let re = regexCache.get(src);
  if (!re) {
    re = new RegExp(`^(?:${src})$`);
    if (regexCache.size > 500) regexCache.clear();
    regexCache.set(src, re);
  }
  return re;
};

export function matches(labels: Labels, ms: Matcher[]): boolean {
  return ms.every((m) => {
    const v = labels[m.label] ?? "";
    switch (m.op) {
      case "=":
        return v === m.value;
      case "!=":
        return v !== m.value;
      case "=~":
        return anchored(m.value).test(v);
      default:
        return !anchored(m.value).test(v);
    }
  });
}

/** The selector of a `label/values` match[] (a bare selector expression). */
export function selectorMatchers(src: string): Matcher[] {
  const n = parse(src);
  if (n.t !== "sel") throw new Error("expected a selector");
  return n.matchers;
}

type Result = { metric: Labels; value?: [number, string]; values?: [number, string][] };

/** Same JSON shape as VictoriaMetrics' /api/v1/query. */
export function instantQuery(src: SeriesSource, query: string, t: number) {
  const v = evaluate(parse(query), src, t);
  const ts = t / 1000;
  const result: Result[] =
    v.k === "scalar"
      ? Number.isFinite(v.v)
        ? [{ metric: {}, value: [ts, String(v.v)] }]
        : []
      : v.s.filter((x) => Number.isFinite(x.v)).map((x) => ({ metric: x.labels, value: [ts, String(x.v)] }));
  return { status: "success", data: { resultType: "vector", result } };
}

/** Same JSON shape as VictoriaMetrics' /api/v1/query_range. */
export function rangeQuery(src: SeriesSource, query: string, startMs: number, endMs: number, stepMs: number) {
  const ast = parse(query);
  const series = new Map<string, Result>();
  for (let t = startMs; t <= endMs; t += stepMs) {
    const v = evaluate(ast, src, t);
    const samples = v.k === "scalar" ? [{ labels: {}, v: v.v }] : v.s;
    for (const x of samples) {
      if (!Number.isFinite(x.v)) continue;
      const key = keyOf(x.labels);
      const r = series.get(key) ?? { metric: x.labels, values: [] };
      r.values!.push([t / 1000, String(x.v)]);
      series.set(key, r);
    }
  }
  return { status: "success", data: { resultType: "matrix", result: [...series.values()] } };
}
