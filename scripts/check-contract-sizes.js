/*
  Compute deployed bytecode sizes for compiled contracts and compare to Hyperliquid's limit.

  Usage:
    node scripts/check-contract-sizes.js [--limit 24576] [--verbose]

  Notes:
  - Reads Hardhat artifacts (artifacts/src/*.json or artifacts/contracts/*.json depending on setup).
  - Uses deployedBytecode length. Each pair of hex chars (excluding 0x) = 1 byte.
  - Default limit is 24,576 bytes (EIP-170). Override with --limit.
*/

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {
    limit: 24576,
    verbose: false,
    threshold: 0.9,
    noColor: false,
    bar: 20,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--verbose" || a === "-v") args.verbose = true;
    else if (a === "--limit") {
      const val = Number(argv[i + 1]);
      if (!Number.isFinite(val) || val <= 0) {
        throw new Error("Invalid --limit value");
      }
      args.limit = val;
      i++;
    } else if (a === "--threshold") {
      const val = Number(argv[i + 1]);
      if (!Number.isFinite(val) || val <= 0 || val >= 1) {
        throw new Error("Invalid --threshold value (expected 0<value<1)");
      }
      args.threshold = val;
      i++;
    } else if (a === "--no-color") {
      args.noColor = true;
    } else if (a === "--bar") {
      const val = Number(argv[i + 1]);
      if (!Number.isFinite(val) || val < 0 || val > 100) {
        throw new Error("Invalid --bar value (expected 0..100)");
      }
      args.bar = Math.floor(val);
      i++;
    }
  }
  return args;
}

function findArtifactRoots(projectRoot) {
  const roots = [];
  const artifactsDir = path.join(projectRoot, "artifacts");
  if (!fs.existsSync(artifactsDir)) return roots;
  const candidates = [
    path.join(artifactsDir, "src"),
    path.join(artifactsDir, "contracts"),
    path.join(artifactsDir, "src", ""),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) roots.push(c);
  }
  return roots.length ? roots : [artifactsDir];
}

function listJsonFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile() && ent.name.endsWith(".json")) out.push(p);
    }
  }
  return out;
}

function getDeployedBytecodeLength(bytecode) {
  if (!bytecode || typeof bytecode !== "string") return 0;
  const hex = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;
  if (hex.length === 0) return 0;
  return Math.floor(hex.length / 2);
}

function formatRow(cols, widths, aligns) {
  const alignList =
    aligns && aligns.length
      ? aligns
      : cols.map((_, i) => (i === 0 ? "left" : "right"));
  return cols
    .map((c, i) => formatCell(String(c), widths[i], alignList[i]))
    .join("  ");
}

const ANSI_RE = /\u001b\[[0-9;]*m/g;

function stripAnsi(s) {
  return s.replace(ANSI_RE, "");
}

function visibleLength(s) {
  return stripAnsi(s).length;
}

function truncateVisible(s, width) {
  let out = "";
  let vis = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\u001b") {
      // copy the whole ANSI sequence without affecting visible width
      let j = i + 1;
      while (j < s.length && s[j] !== "m") j++;
      if (j < s.length) {
        out += s.slice(i, j + 1);
        i = j; // loop will i++
        continue;
      }
      // Fallback: if broken sequence, skip it
      continue;
    }
    if (vis < width) {
      out += ch;
      vis++;
    } else {
      break;
    }
  }
  return out;
}

function padStartVisible(s, width) {
  const pad = Math.max(0, width - visibleLength(s));
  return " ".repeat(pad) + s;
}

function padEndVisible(s, width) {
  const pad = Math.max(0, width - visibleLength(s));
  return s + " ".repeat(pad);
}

function formatCell(str, width, align) {
  const vlen = visibleLength(str);
  let s = vlen > width ? truncateVisible(str, width) : str;
  if (align === "right") return padStartVisible(s, width);
  if (align === "center") {
    const total = Math.max(0, width - visibleLength(s));
    const left = Math.floor(total / 2);
    const right = total - left;
    return " ".repeat(left) + s + " ".repeat(right);
  }
  return padEndVisible(s, width);
}

function withCommas(n) {
  const num = typeof n === "number" ? n : Number(n);
  return Number.isFinite(num) ? num.toLocaleString("en-US") : String(n);
}

function makeStyles(enabled) {
  const on = !!enabled;
  const wrap = (code) => (s) => on ? `\u001b[${code}m${s}\u001b[0m` : s;
  return {
    dim: wrap("2"),
    bold: wrap("1"),
    red: wrap("31"),
    green: wrap("32"),
    yellow: wrap("33"),
    blue: wrap("34"),
    magenta: wrap("35"),
    cyan: wrap("36"),
    gray: wrap("90"),
  };
}

function makeBar(ratio, length, styles) {
  const len = Math.max(0, length | 0);
  if (len === 0) return "";
  const capped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(capped * len);
  const fill = "█".repeat(filled);
  const empty = "░".repeat(Math.max(0, len - filled));
  const bar = `[${fill}${empty}]`;
  if (ratio > 1) return styles.red(bar);
  if (ratio >= 0.95) return styles.yellow(bar);
  return styles.green(bar);
}

function main() {
  const cwd = process.cwd();
  const { limit, verbose, threshold, noColor, bar } = parseArgs(process.argv);
  const styles = makeStyles(
    !noColor && process.stdout.isTTY && !process.env.NO_COLOR
  );

  const roots = findArtifactRoots(cwd);
  const jsonFiles = roots.flatMap(listJsonFiles);

  const results = [];
  for (const file of jsonFiles) {
    let data;
    try {
      const raw = fs.readFileSync(file, "utf8");
      data = JSON.parse(raw);
    } catch (e) {
      if (verbose) console.warn(`Skip unreadable JSON: ${file}`);
      continue;
    }

    const deployed =
      data.deployedBytecode || data.bytecode?.object || data.bytecode;
    const runtime = data.deployedBytecode || data.runtimeBytecode;
    const chosen = deployed || runtime;
    const sizeBytes = getDeployedBytecodeLength(chosen);
    if (!sizeBytes) continue;

    const contractName =
      data.contractName || data.sourceName || path.basename(file, ".json");
    const relativePath = path.relative(cwd, file);

    const overBytes = Math.max(0, sizeBytes - limit);
    const overPct = overBytes > 0 ? (overBytes / limit) * 100 : 0;
    const utilization = sizeBytes / limit;

    results.push({
      contractName,
      relativePath,
      sizeBytes,
      overBytes,
      overPct,
      utilization,
    });
  }

  // De-duplicate by contract name keeping the largest size (some artifacts repeat)
  const byName = new Map();
  for (const r of results) {
    const cur = byName.get(r.contractName);
    if (!cur || r.sizeBytes > cur.sizeBytes) byName.set(r.contractName, r);
  }
  const unique = Array.from(byName.values()).sort(
    (a, b) => b.sizeBytes - a.sizeBytes
  );

  const title = styles.bold(styles.cyan("Hyperliquid Contract Size Report"));
  console.log(title);
  console.log(
    styles.dim(
      `Limit: ${withCommas(limit)} bytes  •  Threshold: ${(
        threshold * 100
      ).toFixed(0)}%  •  ${new Date().toLocaleString()}`
    )
  );
  console.log();

  const headers = [
    "Contract",
    "Size",
    `Over (${withCommas(limit)})`,
    "% over",
    "Util",
    "Status",
  ];
  const widths = [30, 14, 16, 8, Math.max(10, bar + 2), 8];
  const aligns = ["left", "right", "right", "right", "left", "center"];
  console.log(
    formatRow(
      headers.map((h) => styles.bold(styles.blue(h))),
      widths,
      aligns
    )
  );
  console.log(
    formatRow(
      headers.map((h, i) => {
        const d = "-".repeat(Math.min(visibleLength(h), widths[i]));
        return styles.dim(padEndVisible(d, widths[i]));
      }),
      widths,
      aligns
    )
  );

  for (const r of unique) {
    const overStr = r.overBytes > 0 ? withCommas(r.overBytes) : "-";
    const pctStr = `${r.overBytes > 0 ? r.overPct.toFixed(2) : "0.00"}%`;
    const sizeStr = withCommas(r.sizeBytes);
    const barStr = makeBar(r.utilization, bar, styles);
    const status =
      r.overBytes > 0
        ? styles.red("✖ OVER")
        : r.utilization >= threshold
        ? styles.yellow("⚠ NEAR")
        : styles.green("✔ OK");

    const nameStyled =
      r.overBytes > 0
        ? styles.red(r.contractName)
        : r.utilization >= threshold
        ? styles.yellow(r.contractName)
        : r.contractName;
    const row = [nameStyled, sizeStr, overStr, pctStr, barStr, status];
    console.log(formatRow(row, widths, aligns));
    if (verbose) console.log(styles.gray(`  ${r.relativePath}`));
  }

  const offenders = unique.filter((r) => r.overBytes > 0);
  console.log();
  if (offenders.length) {
    const worst = offenders.reduce((a, b) =>
      a.overBytes > b.overBytes ? a : b
    );
    console.log(
      styles.red(
        `${offenders.length} contract(s) exceed the ${withCommas(
          limit
        )} byte limit.`
      )
    );
    console.log(
      styles.red(
        `Worst: ${worst.contractName} by ${withCommas(
          worst.overBytes
        )} bytes (${worst.overPct.toFixed(2)}%)`
      )
    );
    process.exitCode = 1;
  } else {
    const near = unique.filter((r) => r.utilization >= threshold);
    if (near.length) {
      console.log(
        styles.yellow(
          `${near.length} contract(s) near the limit (≥ ${(
            threshold * 100
          ).toFixed(0)}%).`
        )
      );
    }
    console.log(styles.green("All contracts are within the limit."));
  }
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(2);
}
