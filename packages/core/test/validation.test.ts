import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'bun:test';
import { Hono } from '../src/index';
import { openApi } from '../src/middleware/openApiMiddleware';
import { TEnum } from '../src/typesystem';

describe('Validation', () => {
  it('identical parameter names for query and header', async () => {
    const languageCodeSchema = Type.Object({
      languagecode: Type.String({
        examples: 'de',
      }),
    });

    const app = new Hono();

    app.get(
      '/bar',
      openApi({
        query: languageCodeSchema,
        header: languageCodeSchema,
      }),
      (c) =>
        c.json({
          header: c.req.valid('header').languagecode,
          query: c.req.valid('query').languagecode,
        })
    );

    const onlyHeader = await app.request('bar', {
      headers: {
        languageCode: 'de',
      },
    });

    expect(onlyHeader.status).toBe(400);

    const onlyQuery = await app.request('bar?languagecode=en');

    expect(onlyQuery.status).toBe(400);

    const both = await app.request('bar?languagecode=en', {
      headers: {
        languagecode: 'de',
      },
    });

    expect(both.status).toBe(200);
    expect(await both.json()).toEqual({
      header: 'de',
      query: 'en',
    });
  });

  it('header uppercase', async () => {
    const languageCodeSchema = Type.Object({
      languagecode: Type.String({
        examples: 'de',
      }),
    });

    const app = new Hono();

    app.get(
      '/bar',
      openApi({
        header: languageCodeSchema,
      }),
      (c) =>
        c.json({
          header: c.req.valid('header').languagecode,
        })
    );

    const onlyHeader = await app.request('bar', {
      headers: {
        languagecode: 'en',
      },
    });

    expect(onlyHeader.status).toBe(200);

    expect(await onlyHeader.json()).toEqual({
      header: 'en',
    });
  });

  it('Union', async () => {
    const LocationBody = Type.Object({
      house: Type.Object({
        value: Type.Union([
          Type.Object({
            fixPrice: Type.Number({ description: 'price' }),
            currency: TEnum(['EUR', 'USD']),
          }),
          Type.Object({
            optionalPrice: Type.Number({ description: '' }),
            expiration: Type.Date(),
          }),
        ]),
      }),
    });

    const app = new Hono();

    app.post(
      '/test',
      openApi({
        json: LocationBody,
      }),
      (c) => c.json('OK')
    );

    const res = await app.request('/test', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        house: {
          value: {
            fixPrice: 10,
            currency: 'EUR',
          },
        },
      }),
    });

    expect(res.status).toBe(200);
  });

  // it('', () => {
  //   const app = new Hono({
  //     openApi: {
  //       info: {
  //         title: 'title',
  //         version: '0.0.0',
  //       },
  //       openapi: '3.1.0',
  //       defaultTag: 'ICP',
  //     },
  //     verbose: true,
  //   });

  //   const basicSchema = Type.Object({
  //     tets: Type.String(),
  //     second: Type.String(),
  //   });

  //   app.get('/endpointwithoutopenapi/:test', (c) => c.json({ message: 'OK' }));

  //   app.get(
  //     '/test',
  //     openApi({
  //       query: basicSchema,
  //       json: basicSchema,
  //       description: '',
  //       summary: '',
  //       tags: ['Special Tag'],
  //     }),
  //     (c) => {
  //       const { tets } = c.req.valid('json');

  //       if (tets === 'json') {
  //         return c.json({ Hello: 'World', number: 10 });
  //       }

  //       return c.html('<html><h1>Hello</h1></html>');
  //     }
  //   );

  //   const bodySchema = Type.Object({
  //     format: Type.String(),
  //   });

  //   app.post(
  //     '/test/:x',
  //     openApi({
  //       summary: 'My Super summary',
  //       json: bodySchema,
  //       query: basicSchema,
  //     }),
  //     (c) => {
  //       const { format } = c.req.valid('json');

  //       const x = c.req.param();

  //       if (format === 'json') {
  //         return c.json({ Hello: 'World', number: 10 });
  //       }

  //       return c.html('<html><h1>Hello</h1></html>');
  //     }
  //   );
  // });
});
