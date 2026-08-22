import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const requestId = req.id || 'unknown';

  // Log error
  logger.error(`[${requestId}] Error: ${err.message}`, {
    status: err.statusCode || 500,
    path: req.path,
    method: req.method,
    stack: err.stack,
    details: err.details,
  });

  // ApiError instance
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.message,
      details: err.details,
      requestId,
    });
  }

  // Validation errors
  if (err.array && typeof err.array === 'function') {
    return res.status(400).json({
      error: 'Validation error',
      errors: err.array(),
      requestId,
    });
  }

  // Database errors
  if (err.code && err.code.startsWith('23')) {
    return res.status(400).json({
      error: 'Database constraint violation',
      message: err.detail || err.message,
      requestId,
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Invalid token',
      requestId,
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Token expired',
      requestId,
    });
  }

  // Default error
  res.status(err.statusCode || 500).json({
    error: err.message || 'Internal server error',
    requestId,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

// Async route wrapper for cleaner error handling
export const asyncHandler = (fn: any) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const throwError = (statusCode: number, message: string, details?: any) => {
  throw new ApiError(statusCode, message, details);
};
