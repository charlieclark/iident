import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The mannequin picture is read from disk by the route that dresses it.
  outputFileTracingIncludes: { "/api/mannequin": ["./src/assets/mannequin.jpg"] },
  // Local data (the embedded database and stored files) is never part of a build.
  outputFileTracingExcludes: { "/*": ["./data/**/*"] },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
