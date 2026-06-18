import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: false,
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true
  },
  typescript: {
    ignoreBuildErrors: true
  },
  outputFileTracingRoot: projectRoot,
  outputFileTracingExcludes: {
    '/*': [
      './.git/**',
      './.next/cache/**',
      './coverage/**',
      './playwright-report/**',
      './test-results/**',
      './supabase/.branches/**',
      './supabase/.temp/**',
      './node_modules/.cache/**',
      './node_modules/@next/swc-*/**',
      './node_modules/@next/swc-wasm-nodejs/**'
    ]
  }
};

export default nextConfig;
