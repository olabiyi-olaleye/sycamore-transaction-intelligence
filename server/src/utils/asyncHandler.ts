import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

// Express doesn't forward a rejected promise from an async handler to the
// error middleware on its own — unlike Fastify, which does this for every
// route automatically. Every controller in this app is async and throws
// AppError subclasses, so this wrapper is what makes error.middleware.ts
// actually see those errors instead of them becoming unhandled rejections.
export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
