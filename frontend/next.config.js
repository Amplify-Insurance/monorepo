// next.config.js

/** @type {import('next').NextConfig} */
const nextConfig = {
  // --- Your other settings ---
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // --- /Your other settings ---

  // --- Make sure this webpack part is exactly like this ---
  webpack: (config, { isServer }) => {
    // Exclude pino-pretty from the client bundle
    if (!isServer) {
      config.resolve.alias['pino-pretty'] = false;
    }
    // Important: return the modified config
    return config;
  },
  // --- /Make sure this webpack part is exactly like this ---
};

module.exports = nextConfig;