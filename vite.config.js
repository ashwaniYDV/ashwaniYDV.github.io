import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import markdownPosts from "./scripts/markdown-posts.js";

// User site (ashwaniydv.github.io) is served from the domain root.
export default defineConfig({
  base: "/",
  plugins: [markdownPosts(), react()],
});
