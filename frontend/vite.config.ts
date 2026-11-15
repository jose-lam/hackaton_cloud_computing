import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" para que los assets funcionen desde cualquier ruta de S3/CloudFront.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          map: ["leaflet", "react-leaflet"],
        },
      },
    },
  },
});
