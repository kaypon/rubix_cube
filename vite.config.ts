import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

const root = import.meta.dirname;

/**
 * In dev, serve /api/scores from api/scores.js the way Vercel will, so
 * `npm run dev` has a working leaderboard (on the dev board, never the real one).
 */
function devApi(): Plugin {
  return {
    name: "dev-api",
    apply: "serve",
    configureServer(server) {
      Object.assign(process.env, loadEnv(server.config.mode, root, "KV_"));
      // /timer is timer/index.html; Vercel gets the same rewrite in vercel.json.
      server.middlewares.use((req, _res, next) => {
        if (req.url?.split("?")[0] === "/timer") req.url = req.url.replace("/timer", "/timer/");
        next();
      });
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] !== "/api/scores") return next();
        try {
          const mod = await server.ssrLoadModule("/api/scores.js");
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
          headers.set("x-forwarded-for", req.socket.remoteAddress ?? "127.0.0.1");
          const request = new Request(`http://${req.headers.host}${req.url}`, {
            method: req.method,
            headers,
            body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
          });
          const response: Response = await mod.default.fetch(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [devApi()],
  worker: { format: "es" },
  build: {
    // three.js is most of the bundle (~165 kB gzipped); that's expected.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      input: {
        main: resolve(root, "index.html"),
        timer: resolve(root, "timer/index.html"),
      },
    },
  },
});
