/**
 * Reference norms for the topbar metrics, derived from the CLEAR corpus.
 *
 * GENERATED FILE — do not edit by hand. Rebuild with `npm run corpus:norms`.
 *
 *   4724 excerpts, each metric computed with the app's own
 *   `core/metrics.ts` implementation, so these never drift from the code.
 *   Mean and sample standard deviation (n − 1).
 *
 * Source: CLEAR — CommonLit Ease of Readability corpus
 *   https://github.com/scrosseye/CLEAR-Corpus
 *   Crossley, Heintz, Choi, Batchelor, Karimi & Malatinszky (2021, 2022)
 *   Licensed CC BY-NC-SA 4.0 — non-commercial use with attribution. The
 *   corpus text itself is NOT redistributed here; only these aggregate
 *   statistics. Rebuilding requires downloading the corpus yourself.
 *
 * Each metric records the mean, the sample standard deviation, and the
 * empirical quantiles p0…p100. Percentiles come from the quantiles rather than
 * from a normal approximation: these distributions are skewed (words per
 * sentence spans 3.9…101.5), so converting a z-score through the normal CDF
 * would misreport the tails.
 *
 * Only length-normalised ratios are recorded: corpus excerpts are a roughly
 * fixed length, so comparing raw counts (words, characters) against them would
 * be meaningless.
 */

export interface CorpusStat {
  mean: number;
  sd: number;
}

export interface MetricNorm extends CorpusStat {
  /** Empirical quantiles p0…p100 — 101 ascending values. */
  quantiles: number[];
}

export interface CorpusNorms {
  name: string;
  source: string;
  license: string;
  /** Excerpts that contributed, after dropping anything under 20 words. */
  n: number;
  /** Context for tooltips — the corpus is made of short excerpts. */
  wordsPerExcerpt: CorpusStat;
  metrics: {
    wordsPerSentence: MetricNorm;
    charactersPerWord: MetricNorm;
    polysyllabicShare: MetricNorm;
    unfamiliarShare: MetricNorm;
    syllablesPerWord: MetricNorm;
  };
}

export const CLEAR_CORPUS: CorpusNorms = {
  name: 'CLEAR corpus',
  source: 'https://github.com/scrosseye/CLEAR-Corpus',
  license: 'CC BY-NC-SA 4.0',
  n: 4724,
  wordsPerExcerpt: { mean: 173.8, sd: 17.1 },
  metrics: {
    wordsPerSentence: { mean: 21.2829, sd: 9.233, quantiles: [3.921, 6.448, 7.613, 8.235, 8.777, 9.192, 9.667, 10.071, 10.526, 10.923, 11.339, 11.667, 11.937, 12.25, 12.583, 12.857, 13.143, 13.385, 13.714, 14, 14.176, 14.455, 14.751, 15, 15.167, 15.417, 15.636, 15.833, 16.091, 16.265, 16.455, 16.636, 16.818, 17.091, 17.333, 17.5, 17.667, 17.818, 18, 18.1, 18.3, 18.5, 18.667, 18.889, 19.1, 19.3, 19.477, 19.625, 19.876, 20, 20.25, 20.421, 20.571, 20.778, 21, 21.143, 21.333, 21.5, 21.714, 21.883, 22.111, 22.286, 22.5, 22.625, 22.875, 23.125, 23.333, 23.571, 23.75, 24, 24.25, 24.429, 24.667, 24.857, 25.143, 25.333, 25.667, 26, 26.429, 26.714, 27, 27.429, 27.833, 28.143, 28.429, 28.818, 29.333, 29.8, 30.232, 30.8, 31.333, 31.8, 32.5, 33.2, 35.343, 36.6, 38.2, 40.405, 45.25, 52.513, 101.5] },
    charactersPerWord: { mean: 4.4419, sd: 0.4345, quantiles: [3.142, 3.597, 3.682, 3.723, 3.765, 3.803, 3.836, 3.857, 3.877, 3.897, 3.919, 3.936, 3.955, 3.971, 3.985, 4.005, 4.021, 4.032, 4.048, 4.061, 4.075, 4.089, 4.103, 4.115, 4.125, 4.138, 4.149, 4.163, 4.173, 4.185, 4.195, 4.205, 4.215, 4.224, 4.236, 4.247, 4.258, 4.271, 4.28, 4.289, 4.296, 4.304, 4.314, 4.323, 4.333, 4.346, 4.357, 4.367, 4.376, 4.388, 4.397, 4.409, 4.42, 4.429, 4.442, 4.456, 4.468, 4.48, 4.49, 4.503, 4.515, 4.526, 4.537, 4.548, 4.561, 4.573, 4.586, 4.603, 4.615, 4.626, 4.639, 4.653, 4.667, 4.682, 4.698, 4.711, 4.724, 4.74, 4.753, 4.774, 4.792, 4.811, 4.83, 4.851, 4.868, 4.889, 4.907, 4.934, 4.955, 4.98, 5.012, 5.043, 5.075, 5.117, 5.163, 5.214, 5.268, 5.355, 5.446, 5.631, 6.884] },
    polysyllabicShare: { mean: 0.0958, sd: 0.06, quantiles: [0, 0.0052, 0.0069, 0.0115, 0.0137, 0.0164, 0.0189, 0.0207, 0.0225, 0.025, 0.0265, 0.0278, 0.0298, 0.0311, 0.0325, 0.0343, 0.0357, 0.037, 0.0387, 0.0402, 0.0414, 0.0427, 0.0446, 0.0457, 0.0473, 0.0491, 0.0508, 0.0521, 0.0543, 0.0559, 0.057, 0.0585, 0.06, 0.0615, 0.0629, 0.0645, 0.066, 0.067, 0.0684, 0.0699, 0.0714, 0.0726, 0.0743, 0.0758, 0.077, 0.0782, 0.08, 0.0813, 0.0828, 0.0845, 0.0862, 0.0877, 0.0895, 0.0914, 0.0929, 0.0943, 0.096, 0.0976, 0.0994, 0.1011, 0.1027, 0.1049, 0.107, 0.1088, 0.1105, 0.1122, 0.1139, 0.116, 0.1176, 0.1198, 0.1218, 0.1239, 0.1263, 0.1282, 0.1307, 0.1327, 0.1347, 0.137, 0.1392, 0.1412, 0.1436, 0.1459, 0.1493, 0.1522, 0.156, 0.159, 0.1629, 0.1658, 0.1693, 0.1735, 0.1784, 0.1823, 0.1882, 0.1931, 0.2011, 0.2062, 0.2152, 0.2269, 0.2437, 0.2674, 0.3935] },
    unfamiliarShare: { mean: 0.1757, sd: 0.099, quantiles: [0, 0.0169, 0.0252, 0.0314, 0.0357, 0.041, 0.0455, 0.0497, 0.0533, 0.0564, 0.06, 0.0623, 0.0656, 0.0684, 0.0719, 0.0751, 0.0774, 0.0802, 0.0833, 0.0857, 0.088, 0.0904, 0.0926, 0.0952, 0.0972, 0.1, 0.1026, 0.1046, 0.1067, 0.1092, 0.1118, 0.1142, 0.1169, 0.1189, 0.1206, 0.123, 0.1256, 0.1276, 0.1302, 0.132, 0.1344, 0.1368, 0.1391, 0.142, 0.1438, 0.1469, 0.1497, 0.1523, 0.1549, 0.1568, 0.1593, 0.1616, 0.1642, 0.1668, 0.1702, 0.1724, 0.1748, 0.1772, 0.1799, 0.1833, 0.1865, 0.19, 0.1929, 0.1962, 0.2, 0.2041, 0.2071, 0.2105, 0.2139, 0.2177, 0.2209, 0.2241, 0.2283, 0.2316, 0.2349, 0.2384, 0.242, 0.2461, 0.25, 0.2541, 0.2576, 0.2621, 0.2663, 0.2727, 0.2778, 0.2818, 0.2887, 0.2952, 0.302, 0.3085, 0.3148, 0.3239, 0.3312, 0.3389, 0.3518, 0.3636, 0.3786, 0.3939, 0.4157, 0.4444, 0.58] },
    syllablesPerWord: { mean: 1.4147, sd: 0.1649, quantiles: [1.007, 1.137, 1.156, 1.169, 1.182, 1.191, 1.201, 1.206, 1.212, 1.216, 1.221, 1.228, 1.234, 1.239, 1.243, 1.25, 1.254, 1.257, 1.263, 1.268, 1.272, 1.277, 1.281, 1.286, 1.29, 1.294, 1.298, 1.303, 1.306, 1.31, 1.314, 1.317, 1.321, 1.325, 1.328, 1.332, 1.337, 1.34, 1.344, 1.348, 1.352, 1.356, 1.359, 1.364, 1.367, 1.37, 1.374, 1.379, 1.383, 1.386, 1.39, 1.394, 1.397, 1.403, 1.407, 1.411, 1.417, 1.421, 1.426, 1.431, 1.437, 1.441, 1.445, 1.45, 1.456, 1.461, 1.466, 1.47, 1.476, 1.481, 1.486, 1.492, 1.497, 1.503, 1.508, 1.513, 1.519, 1.527, 1.533, 1.54, 1.547, 1.553, 1.559, 1.567, 1.575, 1.585, 1.594, 1.604, 1.614, 1.622, 1.634, 1.647, 1.661, 1.676, 1.694, 1.712, 1.739, 1.772, 1.823, 1.891, 2.387] },
  },
};
