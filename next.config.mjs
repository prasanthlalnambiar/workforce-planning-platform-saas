import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: false,
  reactStrictMode: true,
  // TypeScript and ESLint remain mandatory standalone gates in CI and npm run verify.
  // They are intentionally separated from Next's internal build validation so
  // hermetic production builds do not hang in external sandbox environments.
  typescript: {
    ignoreBuildErrors: true
  },
  eslint: {
    ignoreDuringBuilds: true
  },
  // External QA sandboxes have hung while Next is collecting page data through
  // its default worker pool. This app is fully dynamic, so keep build-time
  // static analysis single-lane and deterministic.
  experimental: {
    cpus: 1,
    staticGenerationMaxConcurrency: 1,
    staticGenerationMinPagesPerWorker: 1
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
