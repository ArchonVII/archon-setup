// Minimal pure unified diff (zero-dep, line-LCS). The server computes every
// diff a human sees (frontend spec rule R2; distributor design §9/DL5) — the
// inputs here are managed-region inners and single files, so the quadratic
// LCS table is fine. Returns "" when the texts are equal.
export function unifiedDiff(before, after, { aLabel = "a", bLabel = "b", context = 3 } = {}) {
  if (before === after) return "";

  const a = splitLines(before);
  const b = splitLines(after);
  const ops = diffOps(a, b);
  const lines = [`--- ${aLabel}`, `+++ ${bLabel}`, ...hunks(ops, context)];
  return `${lines.join("\n")}\n`;
}

function splitLines(text) {
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function diffOps(a, b) {
  // dp[x][y] = LCS length of a[x:] vs b[y:]
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let x = a.length - 1; x >= 0; x -= 1) {
    for (let y = b.length - 1; y >= 0; y -= 1) {
      dp[x][y] = a[x] === b[y] ? dp[x + 1][y + 1] + 1 : Math.max(dp[x + 1][y], dp[x][y + 1]);
    }
  }

  const ops = [];
  let x = 0;
  let y = 0;
  while (x < a.length && y < b.length) {
    if (a[x] === b[y]) {
      ops.push({ t: " ", line: a[x] });
      x += 1;
      y += 1;
    } else if (dp[x + 1][y] >= dp[x][y + 1]) {
      ops.push({ t: "-", line: a[x] });
      x += 1;
    } else {
      ops.push({ t: "+", line: b[y] });
      y += 1;
    }
  }
  while (x < a.length) ops.push({ t: "-", line: a[x++] });
  while (y < b.length) ops.push({ t: "+", line: b[y++] });
  return ops;
}

function hunks(ops, context) {
  const changedIdx = [];
  ops.forEach((op, idx) => {
    if (op.t !== " ") changedIdx.push(idx);
  });
  if (!changedIdx.length) return [];

  // Merge changed indices into ranges, padding each side with `context` lines.
  const ranges = [];
  let start = Math.max(0, changedIdx[0] - context);
  let end = Math.min(ops.length, changedIdx[0] + context + 1);
  for (const idx of changedIdx.slice(1)) {
    if (idx - context <= end) {
      end = Math.min(ops.length, idx + context + 1);
    } else {
      ranges.push([start, end]);
      start = Math.max(0, idx - context);
      end = Math.min(ops.length, idx + context + 1);
    }
  }
  ranges.push([start, end]);

  // Pre-compute the 1-based a/b line numbers at every op index.
  let aNum = 1;
  let bNum = 1;
  const pos = ops.map((op) => {
    const here = { a: aNum, b: bNum };
    if (op.t !== "+") aNum += 1;
    if (op.t !== "-") bNum += 1;
    return here;
  });

  const out = [];
  for (const [s, e] of ranges) {
    const slice = ops.slice(s, e);
    const aLen = slice.filter((op) => op.t !== "+").length;
    const bLen = slice.filter((op) => op.t !== "-").length;
    out.push(`@@ -${pos[s].a},${aLen} +${pos[s].b},${bLen} @@`);
    for (const op of slice) out.push(`${op.t}${op.line}`);
  }
  return out;
}
