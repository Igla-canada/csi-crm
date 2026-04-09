import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.2.81"],
  serverExternalPackages: ["googleapis"],
  transpilePackages: ["@date-fns/tz"],
};

export default nextConfig;
