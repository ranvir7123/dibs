import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Where Next.js keeps its build files. Each lane sets DIBS_DIST_DIR to its
  // own folder (for example .next-a) so several lanes can run the app at once.
  distDir: process.env.DIBS_DIST_DIR || ".next",
  // The embedded database ships its own files, so it is loaded as it is
  // instead of being packed into the app's bundle. The same goes for
  // ffmpeg-static, which carries the program that cuts a recording into pictures.
  serverExternalPackages: ["@electric-sql/pglite", "ffmpeg-static"],
};

export default nextConfig;
