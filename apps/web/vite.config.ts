import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.VITE_API_TARGET || "http://localhost:3220";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    // In production the API serves this build same-origin; in dev we proxy so
    // session cookies and the OIDC callback behave identically.
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
      "/auth": { target: API_TARGET, changeOrigin: true },
      "/health": { target: API_TARGET, changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
