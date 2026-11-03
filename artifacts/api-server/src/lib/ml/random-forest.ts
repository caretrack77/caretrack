/**
 * Random Forest classifier (Breiman, 2001), implemented from scratch so every step
 * can be explained:
 *
 *  1. Bagging: each tree is trained on a bootstrap sample (rows drawn with replacement).
 *  2. Each tree is a CART decision tree. At every node it tries a random subset of
 *     features (sqrt of the total) and picks the threshold with the lowest Gini impurity.
 *  3. A prediction is the average of the class probabilities from all trees (soft voting).
 *  4. Rows left out of a tree's bootstrap sample ("out-of-bag") are used to measure
 *     accuracy without a separate test set.
 *  5. Feature importance = total Gini impurity reduction each feature produced,
 *     averaged over the trees and normalised to sum to 1.
 */

export type Sample = { features: number[]; label: number };

type Node =
  | { leaf: true; probs: number[] }
  | { leaf: false; feature: number; threshold: number; left: Node; right: Node };

export type ForestOptions = {
  trees?: number;
  maxDepth?: number;
  minSamplesLeaf?: number;
  classes: number;
  seed?: number;
};

/** Small deterministic random generator, so training is reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function classCounts(rows: Sample[], classes: number): number[] {
  const counts = new Array(classes).fill(0);
  for (const row of rows) counts[row.label] += 1;
  return counts;
}

function gini(counts: number[], total: number): number {
  if (total === 0) return 0;
  let sum = 0;
  for (const c of counts) sum += (c / total) ** 2;
  return 1 - sum;
}

class DecisionTree {
  root: Node;
  importance: number[];

  constructor(
    rows: Sample[],
    private opts: Required<Omit<ForestOptions, "seed" | "trees">> & { featureCount: number },
    private random: () => number,
  ) {
    this.importance = new Array(opts.featureCount).fill(0);
    this.root = this.build(rows, 0);
  }

  private leaf(rows: Sample[]): Node {
    const counts = classCounts(rows, this.opts.classes);
    return { leaf: true, probs: counts.map((c) => c / Math.max(1, rows.length)) };
  }

  private build(rows: Sample[], depth: number): Node {
    const counts = classCounts(rows, this.opts.classes);
    const impurity = gini(counts, rows.length);
    if (
      depth >= this.opts.maxDepth ||
      rows.length < this.opts.minSamplesLeaf * 2 ||
      impurity === 0
    ) {
      return this.leaf(rows);
    }

    // Random subset of features (sqrt rule) considered at this split.
    const featureCount = this.opts.featureCount;
    const tryCount = Math.max(1, Math.round(Math.sqrt(featureCount)));
    const candidates = [...Array(featureCount).keys()]
      .map((f) => ({ f, r: this.random() }))
      .sort((a, b) => a.r - b.r)
      .slice(0, tryCount)
      .map((x) => x.f);

    let best: { feature: number; threshold: number; score: number } | null = null;
    for (const feature of candidates) {
      const sorted = [...rows].sort((a, b) => a.features[feature] - b.features[feature]);
      const left = new Array(this.opts.classes).fill(0);
      const right = [...counts];
      for (let i = 0; i < sorted.length - 1; i += 1) {
        left[sorted[i].label] += 1;
        right[sorted[i].label] -= 1;
        const value = sorted[i].features[feature];
        const next = sorted[i + 1].features[feature];
        if (value === next) continue;
        const nLeft = i + 1;
        const nRight = sorted.length - nLeft;
        if (nLeft < this.opts.minSamplesLeaf || nRight < this.opts.minSamplesLeaf) continue;
        const score =
          (nLeft / sorted.length) * gini(left, nLeft) + (nRight / sorted.length) * gini(right, nRight);
        if (!best || score < best.score) {
          best = { feature, threshold: (value + next) / 2, score };
        }
      }
    }
    if (!best || best.score >= impurity) return this.leaf(rows);

    // Weighted impurity decrease, used for feature importance.
    this.importance[best.feature] += (impurity - best.score) * rows.length;
    const leftRows = rows.filter((r) => r.features[best!.feature] <= best!.threshold);
    const rightRows = rows.filter((r) => r.features[best!.feature] > best!.threshold);
    return {
      leaf: false,
      feature: best.feature,
      threshold: best.threshold,
      left: this.build(leftRows, depth + 1),
      right: this.build(rightRows, depth + 1),
    };
  }

  predict(features: number[]): number[] {
    let node = this.root;
    while (!node.leaf) {
      node = features[node.feature] <= node.threshold ? node.left : node.right;
    }
    return node.probs;
  }
}

export class RandomForest {
  private trees: DecisionTree[] = [];
  featureImportance: number[] = [];
  oobAccuracy: number | null = null;
  readonly options: Required<ForestOptions>;

  constructor(options: ForestOptions) {
    this.options = {
      trees: 60,
      maxDepth: 6,
      minSamplesLeaf: 3,
      seed: 42,
      ...options,
    };
  }

  fit(samples: Sample[]): this {
    if (samples.length === 0) throw new Error("No training samples.");
    const featureCount = samples[0].features.length;
    const random = mulberry32(this.options.seed);
    const importance = new Array(featureCount).fill(0);
    // Out-of-bag votes: for each sample, summed probabilities from trees that didn't see it.
    const oobVotes = samples.map(() => new Array(this.options.classes).fill(0));
    const oobSeen = new Array(samples.length).fill(false);

    this.trees = [];
    for (let t = 0; t < this.options.trees; t += 1) {
      const inBag = new Set<number>();
      const bootstrap: Sample[] = [];
      for (let i = 0; i < samples.length; i += 1) {
        const index = Math.floor(random() * samples.length);
        inBag.add(index);
        bootstrap.push(samples[index]);
      }
      const tree = new DecisionTree(
        bootstrap,
        {
          maxDepth: this.options.maxDepth,
          minSamplesLeaf: this.options.minSamplesLeaf,
          classes: this.options.classes,
          featureCount,
        },
        random,
      );
      this.trees.push(tree);
      tree.importance.forEach((value, f) => (importance[f] += value));
      samples.forEach((sample, i) => {
        if (inBag.has(i)) return;
        oobSeen[i] = true;
        tree.predict(sample.features).forEach((p, c) => (oobVotes[i][c] += p));
      });
    }

    const total = importance.reduce((a, b) => a + b, 0) || 1;
    this.featureImportance = importance.map((v) => v / total);

    let correct = 0;
    let counted = 0;
    samples.forEach((sample, i) => {
      if (!oobSeen[i]) return;
      counted += 1;
      if (argmax(oobVotes[i]) === sample.label) correct += 1;
    });
    this.oobAccuracy = counted ? correct / counted : null;
    return this;
  }

  /** Class probabilities, averaged over all trees. */
  predictProba(features: number[]): number[] {
    const sum = new Array(this.options.classes).fill(0);
    for (const tree of this.trees) {
      tree.predict(features).forEach((p, c) => (sum[c] += p));
    }
    return sum.map((v) => v / Math.max(1, this.trees.length));
  }
}

export function argmax(values: number[]): number {
  let best = 0;
  values.forEach((v, i) => {
    if (v > values[best]) best = i;
  });
  return best;
}
