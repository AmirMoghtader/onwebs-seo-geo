/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  // The floating dev badge sits over the bottom-left of the app's own chrome,
  // where this project already draws its status bar.
  devIndicators: false,
};

module.exports = nextConfig;
