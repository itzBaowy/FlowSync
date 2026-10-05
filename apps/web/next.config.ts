import type { NextConfig } from 'next';
import { config } from 'dotenv';
config({ path: '../../.env', quiet: true });
const nextConfig: NextConfig = {
  output: process.env.FLOWSYNC_STANDALONE === 'true' ? 'standalone' : undefined,
  transpilePackages: ['@flowsync/contracts'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default nextConfig;
