import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
    deviceSizes: [640, 1080, 1920],
    imageSizes: [32, 64, 96, 192, 288, 384, 600],
    formats: ["image/webp"],
    qualities: [75],
    minimumCacheTTL: 2678400,
  },
  compress: true,
};

export default nextConfig;
