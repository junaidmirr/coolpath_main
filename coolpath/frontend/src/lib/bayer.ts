/**
 * Standard 8x8 Bayer Ordered Dither Matrix
 * Values range from 0 to 63. We normalize them to 0.0 - 1.0 for use in thresholds.
 */
const BAYER_MATRIX_8X8 = [
  [ 0, 32,  8, 40,  2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44,  4, 36, 14, 46,  6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [ 3, 35, 11, 43,  1, 33,  9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47,  7, 39, 13, 45,  5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21]
];

// Pre-calculate normalized matrix (0.0 to 1.0)
const NORMALIZED_BAYER: number[][] = BAYER_MATRIX_8X8.map(row => 
  row.map(val => val / 64.0)
);

/**
 * Get the threshold value for a given (x, y) coordinate.
 * @param x Pixel x coordinate
 * @param y Pixel y coordinate
 * @returns Threshold value between 0.0 and 1.0
 */
export function getBayerThreshold(x: number, y: number): number {
  return NORMALIZED_BAYER[y % 8][x % 8];
}
