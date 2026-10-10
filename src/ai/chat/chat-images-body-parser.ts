import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, type Request, type Response, type NextFunction } from 'express';

/** Larger JSON limit only on the two chat send routes; parser errors are sanitized. */
export function configureChatImageBodyParser(
  app: NestExpressApplication,
): void {
  const parser = json({ limit: 9 * 1024 * 1024 });
  app.use(
    /^\/v1\/chat\/sessions\/[^/]+\/messages(?:\/stream)?\/?$/,
    (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'POST') return next();
      parser(req, res, (error?: unknown) => {
        if (!error) return next();
        const tooLarge =
          (error as { type?: string }).type === 'entity.too.large';
        res.status(tooLarge ? 413 : 400).json({
          code: tooLarge ? 'CHAT_BODY_TOO_LARGE' : 'VALIDATION_FAILED',
          message: tooLarge
            ? 'Nội dung chat vượt giới hạn 9 MiB'
            : 'JSON không hợp lệ',
        });
      });
    },
  );
}
