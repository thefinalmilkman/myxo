// A plain CommonJS module — Nx calls these as fenced capabilities via jscall, no knowledge of Node required.
module.exports.add = (a, b) => a + b;
module.exports.stats = (nums) => ({
  sum: nums.reduce((s, x) => s + x, 0),
  max: Math.max(...nums),
  n: nums.length,
});
module.exports.echo = (x) => x;   // identity: tests value round-trip across languages
