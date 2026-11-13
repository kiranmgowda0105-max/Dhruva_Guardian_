import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Backend the website sends alerts to.
// Default: Render. Override for local testing:
//   $env:VITE_BACKEND_URL="http://localhost:8000"; npm run dev
const BACKEND = process.env.VITE_BACKEND_URL || "https://dhruva-guardian.onrender.com";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: BACKEND,
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});