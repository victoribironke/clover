import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // self-contained server for the Docker image (see Dockerfile)
  output: "standalone",
  // The repo root holds the bot and its own lockfile. Pin the app root to web/ so builds and the
  // standalone output don't depend on what sits above it.
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
  // Firestore's gRPC client loads files at runtime; keep it out of the bundle
  serverExternalPackages: ["@google-cloud/firestore"],
};

export default nextConfig;
