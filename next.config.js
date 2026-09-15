const { PHASE_DEVELOPMENT_SERVER } = require("next/constants");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = (phase) => ({
  ...nextConfig,
  // Keep development assets separate from production-build output. Running
  // `next build` while the dev server is open can otherwise replace files
  // that the active server still references, causing CSS/JS asset 404s.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
});
