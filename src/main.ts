import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import compression = require('compression');
import cookieParser = require('cookie-parser');
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

// Teach JSON.stringify how to serialise BigInt. Prisma returns BigInt for
// any int8 column (Listing.priceNaira, ListingPriceHistory.oldPrice etc.)
// and Express's res.json() crashes with "Do not know how to serialize a
// BigInt" otherwise. Naira amounts are well within Number.MAX_SAFE_INTEGER
// (2^53 ≈ ₦9 quadrillion), so Number coercion is loss-free for our domain.
// Belt-and-braces alongside the explicit Number() conversions in serializers.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this);
};

async function bootstrap() {
  const prodOrigins = [
    'https://propertyloopmain.netlify.app',
    'https://property-loop.netlify.app',
    'https://waitlist.propertyloop.ng',
    'https://propertyloop.ng',
    'https://www.propertyloop.ng',
    'https://admin.propertyloop.ng',
  ];
  const origins =
    process.env.NODE_ENV === 'production'
      ? prodOrigins
      : [
          'http://localhost:5173',
          'http://localhost:5174', // admin app
          ...prodOrigins,
        ];

  // CORS must be configured at app creation so the preflight handler is
  // registered before helmet/compression/body-parser. Registering enableCors
  // after these middlewares meant the multipart upload preflight was being
  // intercepted (or stripped) before CORS could add Access-Control-Allow-Origin.
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    cors: { origin: origins, credentials: true },
  });
  // Behind Railway/Render's proxy: trust X-Forwarded-* so req.secure reflects
  // the original HTTPS scheme (used to set SameSite=None; Secure cookies) and
  // req.ip is the real client IP (used for rate limiting).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  // Capture the raw request body on the parser that actually reads the stream.
  // Paystack webhook signatures are an HMAC over the EXACT bytes they send, so
  // verification must run on the raw body, not re-serialized JSON. This manual
  // json() parser consumes the stream before Nest's built-in rawBody capture
  // can, so we stash the buffer here — otherwise @RawBody() on /payments/webhook
  // is empty and every webhook fails signature verification silently.
  // 2mb comfortably covers our largest JSON payloads (a listing create with a
  // rich-text description + media URLs). File uploads don't pass through here —
  // they're multipart, parsed by multer with its own per-route size caps — so a
  // large limit only widens the memory-exhaustion DoS surface for free.
  app.use(
    json({
      limit: '2mb',
      verify: (req, _res, buf: Buffer) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ limit: '2mb', extended: true }));
  app.use(cookieParser());
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression());

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
