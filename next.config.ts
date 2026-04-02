import path from "path";
import type { NextConfig } from "next";
import { fileURLToPath } from "url";

const configDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: configDir,
    resolveAlias: {
      tailwindcss: path.join(configDir, "node_modules/tailwindcss"),
    },
  },
};

export default nextConfig;
