/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@agentsurely/sdk"],
  webpack: (config) => {
    // wagmi connectors pull optional deps we don't use
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};
export default nextConfig;
