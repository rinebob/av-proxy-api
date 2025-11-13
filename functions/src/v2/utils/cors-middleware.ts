import cors from 'cors';
import { Request, Response } from 'express';

// List your allowed origins (add more as needed)
export const ALLOWED_ORIGINS = [
  'https://av-proxy-api--alpha-vantage-proxy-api.us-central1.hosted.app',
  'https://www.savantapi.com',
  'https://savantapi.com',
  'http://localhost:4200',
  // Savant partner apps
  'https://savanttrader.com',
  'https://www.savanttrader.com',
  'https://earningssavant.com',
  'https://www.earningssavant.com',
  'https://dividendsavant.com',
  'https://www.dividendsavant.com',
  'https://optionsavant.com',
  'https://www.optionsavant.com',
  // Additional partner app hosting URLs
  'https://rel-str--rel-str.us-central1.hosted.app',
];

// Helper: allow any localhost/127.0.0.1 port and *.hosted.app
function isDynamicallyAllowed(origin?: string | null): boolean {
  if (!origin) return true; // same-origin or server-to-server
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    // Any localhost/127.0.0.1 (any scheme, any port)
    if (host === 'localhost' || host === '127.0.0.1') return true;
    // Any Firebase App Hosting *.hosted.app
    if (host.endsWith('.hosted.app')) return true;
  } catch {}
  return false;
}

// Configure the CORS middleware
const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.FIREBASE_EMULATOR_HUB;
const corsMiddleware = cors({
  origin: isEmulator
    // Emulator: allow all origins for fast local dev
    ? true
    // Non-emulator: use allowlist + dynamic localhost/hosted.app
    : (origin, callback) => {
        // Quiet by default; enable if needed for debugging
        // console.log(`corsMiddleware: Origin: ${origin}`);
        if (!origin || ALLOWED_ORIGINS.includes(origin) || isDynamicallyAllowed(origin)) {
          callback(null, true);
        } else {
          // Do not throw: deny CORS by returning false so server doesn’t emit 500
          callback(null, false);
        }
      },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  // When allowedHeaders is undefined, cors mirrors Access-Control-Request-Headers automatically
  optionsSuccessStatus: 204,
});

// Correct: Returns a handler, NOT an onRequest
export function withCors(handler: (req: Request, res: Response) => any) {
  // Quiet by default; this function is invoked once per function definition at load time
  // console.log(`withCors called`);
  return async (req: Request, res: Response) => {
    corsMiddleware(req, res, async () => {
      try {
        // Support both sync and async handlers
        const maybePromise = handler(req, res);
        if (maybePromise && typeof (maybePromise as any).then === 'function') {
          await (maybePromise as Promise<unknown>);
        }
      } catch (err) {
        // Uniform error guard so UI doesn't see raw 500s
        const msg = err instanceof Error ? err.message : String(err);
        console.error('withCors handler error:', { message: msg, stack: (err as any)?.stack });
        if (!res.headersSent) {
          res.status(200).json({ success: false, error: 'Internal server error' });
        }
      }
    });
  };
}
