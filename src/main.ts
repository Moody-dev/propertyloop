import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as compression from 'compression';
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
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(json({ limit: '100mb' }));
  app.use(urlencoded({ limit: '100mb', extended: true }));
  app.use(helmet());
  app.use(compression());

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

  app.enableCors({ origin: origins, credentials: true });
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
