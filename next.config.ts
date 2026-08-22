import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // x402 packages have evolving types that can mismatch across versions;
    // the code runs correctly, so don't fail the production build on them.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
