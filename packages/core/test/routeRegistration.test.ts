import { describe, expect, it } from 'bun:test';
import { Hono } from '../src/index';
import { Hono as HonoOriginal } from 'hono';
import { openApi } from '../src/middleware/openApiMiddleware';

describe('Route registration', () => {
  
  it('path, spec, handler registration get', async () => {
    const app = new Hono();

    app.get(
      '/get',
      openApi({
        summary: 'Sample Get',
        description: 'Description',
      }),
      (c) => c.text('OK GET')
    );

    const res = await app.request('/get');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK GET');
  });

  it('swagger served', async () => {
    const app = new Hono();
    const res = await app.request('/swagger.json');
    expect(res.ok).toBeTrue();
  });

  it('swagger served custom path', async () => {
    const app = new Hono({
      openApi: {
        endpoint: '/test',
        info: {
          title: 'title',
          version: '1.0.0',
        },
        openapi: '3.0.1',
      },
    });
    const res = await app.request('/test.json');
    expect(res.ok).toBeTrue();
  });

  it('paths', () => {
    const app = new Hono();
    app.get('/foo', (c) => c.text('ok'));

    const app2 = new Hono();
    app2.get('/bar', (c) => c.text('ok'));

    app.route('/nested', app2);
  });

  describe('/route', () => {
    //Route merging

    it('routes and base path correct', async () => {
      const app = new Hono();
      app.get('/foo', (c) => c.text('ok'));
      const app2 = new Hono();
      app2.get('/nestedApp', (c) => c.text('ok'));
      app.route('/nestedPath', app2);

      const fooPath =
        app.routes.find((r) => r.path === '/foo')?.path ?? 'not found';
      expect('/foo').toBe(fooPath);

      const nestedPath =
        app.routes.find((r) => r.path === '/nestedPath/nestedApp')?.path ??
        'not found';
      expect('/nestedPath/nestedApp').toBe(nestedPath);
    });

    it('routes align with base implementation', async () => {
      const originalApp = new HonoOriginal();
      originalApp.get('/foo', (c) => c.text('ok'));
      const originalApp2 = new HonoOriginal();
      originalApp2.get('/nestedApp', (c) => c.text('ok'));
      originalApp.route('/nestedPath', originalApp2);

      const app = new Hono();
      app.get('/foo', (c) => c.text('ok'));
      const app2 = new Hono();
      app2.get('/nestedApp', (c) => c.text('ok'));
      app.route('/nestedPath', app2);

      const originalExposedRoutes = originalApp.routes.map((r) => r.path);
      originalExposedRoutes.forEach((route) => {
        const foundRoute =
          app.routes.find((r) => r.path === route)?.path ?? 'not found';
        expect(foundRoute).toBe(route);
      });
    });
  });
});
