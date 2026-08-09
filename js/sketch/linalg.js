/* ========================================================================
   linalg.js - Minimal dense linear algebra for the constraint solver.

   Deliberately not a library. The solver needs exactly three things:
   a dense n×n solve, a numerical rank, and the normal equations JᵀJ / Jᵀr.
   Systems here are small (a busy sketch is ~120 parameters), so dense
   Gaussian elimination is the right tool.
   ======================================================================== */
var RP = window.RP || {};

RP.LinAlg = {};

// Solve A x = b for dense n×n A. Gaussian elimination with partial
// pivoting on an augmented copy; A and b are left untouched.
// Returns x, or null if A is singular to working precision.
RP.LinAlg.luSolve = function(A, b, n) {
  var M = new Array(n);
  var i, j, col, r;
  for (i = 0; i < n; i++) {
    var row = new Array(n + 1);
    for (j = 0; j < n; j++) row[j] = A[i][j];
    row[n] = b[i];
    M[i] = row;
  }

  for (col = 0; col < n; col++) {
    var piv = col, best = Math.abs(M[col][col]);
    for (r = col + 1; r < n; r++) {
      var v = Math.abs(M[r][col]);
      if (v > best) { best = v; piv = r; }
    }
    if (best < 1e-14) return null;
    if (piv !== col) { var t = M[piv]; M[piv] = M[col]; M[col] = t; }
    var d = M[col][col];
    for (r = col + 1; r < n; r++) {
      var f = M[r][col] / d;
      if (f === 0) continue;
      for (j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }

  var x = new Array(n);
  for (i = n - 1; i >= 0; i--) {
    var s = M[i][n];
    for (j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
};

// Numerical rank of an m×n matrix, via row echelon with partial pivoting.
// Tolerance is relative to the largest magnitude in the matrix.
RP.LinAlg.rank = function(M, m, n) {
  if (m <= 0 || n <= 0) return 0;
  var A = new Array(m);
  var maxAbs = 0;
  var i, j, r, col;
  for (i = 0; i < m; i++) {
    A[i] = M[i].slice(0, n);
    for (j = 0; j < n; j++) {
      var a = Math.abs(A[i][j]);
      if (a > maxAbs) maxAbs = a;
    }
  }
  if (maxAbs === 0) return 0;
  var tol = 1e-9 * maxAbs;

  var rank = 0, row = 0;
  for (col = 0; col < n && row < m; col++) {
    var piv = -1, best = tol;
    for (r = row; r < m; r++) {
      var v = Math.abs(A[r][col]);
      if (v > best) { best = v; piv = r; }
    }
    if (piv < 0) continue;
    var t = A[piv]; A[piv] = A[row]; A[row] = t;
    var d = A[row][col];
    for (r = row + 1; r < m; r++) {
      var f = A[r][col] / d;
      if (f === 0) continue;
      for (j = col; j < n; j++) A[r][j] -= f * A[row][j];
    }
    row++;
    rank++;
  }
  return rank;
};

// Normal equations for the least-squares step: A = JᵀJ (n×n), g = Jᵀr (n).
// Exploits symmetry — only the upper triangle is accumulated, then mirrored.
RP.LinAlg.normalEquations = function(J, r, m, n) {
  var A = new Array(n), g = new Array(n);
  var i, j, k;
  for (i = 0; i < n; i++) {
    var row = new Array(n);
    for (j = 0; j < n; j++) row[j] = 0;
    A[i] = row;
    g[i] = 0;
  }
  for (k = 0; k < m; k++) {
    var Jk = J[k], rk = r[k];
    for (i = 0; i < n; i++) {
      var v = Jk[i];
      if (v === 0) continue;
      g[i] += v * rk;
      var Ai = A[i];
      for (j = i; j < n; j++) {
        var w = Jk[j];
        if (w !== 0) Ai[j] += v * w;
      }
    }
  }
  for (i = 0; i < n; i++) {
    for (j = 0; j < i; j++) A[i][j] = A[j][i];
  }
  return { A: A, g: g };
};

RP.LinAlg.maxAbs = function(v, n) {
  var best = 0;
  for (var i = 0; i < n; i++) {
    var a = Math.abs(v[i]);
    if (a > best) best = a;
  }
  return best;
};

RP.LinAlg.normSq = function(v, n) {
  var s = 0;
  for (var i = 0; i < n; i++) s += v[i] * v[i];
  return s;
};

RP.LinAlg.zeroMatrix = function(m, n) {
  var M = new Array(m);
  for (var i = 0; i < m; i++) {
    var row = new Array(n);
    for (var j = 0; j < n; j++) row[j] = 0;
    M[i] = row;
  }
  return M;
};
