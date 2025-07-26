import cors from 'cors';
import { Request, Response } from 'express';

// List your allowed origins (add more as needed)
const ALLOWED_ORIGINS = [
  'https://av-proxy-api--alpha-vantage-proxy-api.us-central1.hosted.app',
  'https://www.savantapi.com',
  'http://localhost:4200',
];

// Configure the CORS middleware
const corsMiddleware = cors({
  origin: (origin, callback) => {
    console.log(`corsMiddleware: Origin: ${origin}`);
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Firebase-AppCheck',
    'X-Request-ID',
    'X-Requested-With',
  ],
});

// Correct: Returns a handler, NOT an onRequest
export function withCors(handler: (req: Request, res: Response) => any) {
    console.log(`withCors called`);
  return (req: Request, res: Response) => {
    corsMiddleware(req, res, () => handler(req, res));
  };
}
