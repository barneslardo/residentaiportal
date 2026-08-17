import type { Response } from "express";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
) {
  return res.status(statusCode).json({ error: { code, message, details } });
}

export function errorHandler(err: unknown, _req: unknown, res: Response) {
  if (err instanceof AppError) {
    return sendError(res, err.statusCode, err.code, err.message, err.details);
  }
  console.error(err);
  return sendError(res, 500, "INTERNAL_ERROR", "An unexpected error occurred");
}
