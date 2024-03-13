import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'bun:test';
import { SchemaObject, isSchemaObject } from 'openapi3-ts/oas31';
import { Hono, ValidationCallback } from '../src/index';
import { openApi } from '../src/middleware/openApiMiddleware';

/**
 * Testing input options of hono instance
 */
describe('OpenApiOptions', () => {
  it('pathsInferred', async () => {
    const app = new Hono({
      openApi: {
        info: {
          title: 'title',
          version: '0.0.0',
        },
        openapi: '3.1.0',
      },
    });

    app.get('/foo/:bar/bas/:baz', (c) => c.text('OK'));

    const spec = app.openApiBuilder.getSpec();

    const routeParams = spec.paths?.['/foo/:bar/bas/:baz'].get?.parameters;
    expect(routeParams?.length).toBe(2);
    //@ts-expect-error we do not have a schema ref
    expect(routeParams?.[0].name).toBe('bar');
    //@ts-expect-error we do not have a schema ref
    expect(routeParams?.[1].name).toBe('baz');
  });

  it('ignore routes string', async () => {
    const app = new Hono({
      excludePaths: '/foo',
    });

    app.get('/foo', (c) => c.text('OK'));
    app.post('/foo', (c) => c.text('OK'));
    app.put('/foo', (c) => c.text('OK'));

    app.get('/bar', (c) => c.text('OK'));
    app.post('/bar', (c) => c.text('OK'));
    app.put('/bar', (c) => c.text('OK'));

    const path = app.getOpenAPI31Document().paths;

    if (path !== undefined) {
      expect(Object.keys(path)).toBeArrayOfSize(1);

      expect(path['/bar'].get).toBeDefined();
      expect(path['/bar'].post).toBeDefined();
      expect(path['/bar'].put).toBeDefined();

      expect(path['/foo']).toBeUndefined();
    } else {
      expect().fail('Path object of swagger is not defined');
    }
  });

  it('ignore routes regex', async () => {
    const app = new Hono({
      excludePaths: /foo/,
    });

    app.get('/foo', (c) => c.text('OK'));
    app.post('/foo', (c) => c.text('OK'));
    app.put('/foo', (c) => c.text('OK'));

    app.get('/bar', (c) => c.text('OK'));
    app.post('/bar', (c) => c.text('OK'));
    app.put('/bar', (c) => c.text('OK'));

    const path = app.getOpenAPI31Document().paths;

    if (path !== undefined) {
      expect(Object.keys(path)).toBeArrayOfSize(1);

      expect(path['/bar'].get).toBeDefined();
      expect(path['/bar'].post).toBeDefined();
      expect(path['/bar'].put).toBeDefined();

      expect(path['/foo']).toBeUndefined();
    } else {
      expect().fail('Path object of swagger is not defined');
    }
  });

  it('ignore routes composite', async () => {
    const app = new Hono({
      excludePaths: /private/,
    });

    const app2 = new Hono();
    app2.get('/foo', (c) => c.text('OK'));
    app2.post('/foo', (c) => c.text('OK'));
    app2.put('/foo', (c) => c.text('OK'));

    app2.get('/bar', (c) => c.text('OK'));
    app2.post('/bar', (c) => c.text('OK'));
    app2.put('/bar', (c) => c.text('OK'));

    const app3 = new Hono();

    app3.get('/foo', (c) => c.text('OK'));
    app3.get('/bar', (c) => c.text('OK'));

    app.route('/private', app2);
    app.route('/public', app3);

    const path = app.getOpenAPI31Document().paths;

    if (path !== undefined) {
      expect(Object.keys(path)).toBeArrayOfSize(2);
      expect(
        Object.keys(path).some((key) => key.includes('/private'))
      ).toBeFalse();
      expect(path['/public/foo'].get).toBeDefined();
      expect(path['/public/bar'].get).toBeDefined();
      expect(path['/private/foo']).toBeUndefined();
    } else {
      expect().fail('Path object of swagger is not defined');
    }

    // if (path !== undefined) {
    //   expect(Object.keys(path)).toBeArrayOfSize(1);

    //   expect(path['/bar'].get).toBeDefined();
    //   expect(path['/bar'].post).toBeDefined();
    //   expect(path['/bar'].put).toBeDefined();

    //   expect(path['/foo']).toBeUndefined();
    // } else {
    //   expect().fail('Path object of swagger is not defined');
    // }
  });

  it('custom validation error code', async () => {
    const app = new Hono({
      validationResponse: {
        errorCode: 403,
      },
    });
    app.get(
      '/foo',
      openApi({
        query: Type.Object({
          id: Type.Number(),
        }),
      }),
      async (c) => c.text('OK')
    );

    const res = await app.request('/foo');
    expect(res.status).toBe(403);
  });

  it('custom validation callback called', async () => {
    let callbackCalled = false;
    const validationCallback: ValidationCallback = (c, error) => {
      callbackCalled = true;
    };

    const app = new Hono({
      validationResponse: {
        errorCode: 403,
        validationCallback: validationCallback,
      },
    });
    app.get(
      '/foo',
      openApi({
        query: Type.Object({
          id: Type.Number(),
        }),
      }),
      async (c) => c.text('OK')
    );

    const res = await app.request('/foo');
    expect(res.status).toBe(403);
    expect(callbackCalled).toBeTrue();
  });

  it('custom validation callback with new response', async () => {
    const validationCallback: ValidationCallback = (c, error) => {
      return c.json(
        {
          success: 'maybe',
        },
        204
      );
    };

    const app = new Hono({
      validationResponse: {
        validationCallback: validationCallback,
      },
    });
    app.get(
      '/foo',
      openApi({
        query: Type.Object({
          id: Type.Number(),
        }),
      }),
      async (c) => c.text('OK')
    );

    const res = await app.request('/foo');
    expect(res.status).toBe(204);
    expect(((await res.json()) as any).success).toEqual('maybe');
  });

  it('custom response schemas do not get overwritten', async () => {
    const app = new Hono({
      inSpecPath: './packages/core/test/resources/spec.yaml',
      // responseSampling: {
      //   samplingMode: 'individual',
      // },
    });

    app.post(
      '/location',
      openApi({
        description: 'My Foo',
      }),
      (c) =>
        c.json({
          lat: 50.93,
          lng: 7,
          name: 'Cologne',
          locode: 'DE CGN',
        })
    );

    const response =
      app.getOpenAPI31Document()?.paths?.['/location']?.post?.responses;
    expect(response).toBeObject();
    expect(response).not.toBeEmptyObject();
  });

  it('custom response schemas get expanded after importing', async () => {
    const app = new Hono({
      inSpecPath: './packages/core/test/resources/spec.yaml',
      responseSampling: {
        samplingMode: 'individual',
      },
    });

    app.post(
      '/location',
      openApi({
        description: 'My Foo',
      }),
      (c) =>
        c.json({
          lat: 50.93,
          lng: 7,
          newProperty: true,
          name: 'Cologne',
          locode: 'DE CGN',
        })
    );

    await app.request('/location', {
      method: 'post',
    });

    const definitions =
      (
        app.getOpenAPI31Document()?.components?.schemas?.[
          'LocationResponse'
        ] as SchemaObject
      )?.anyOf ?? [];
    if(isSchemaObject(definitions[1])){
      expect(definitions[1].properties).toContainKey('newProperty');
    }else{
      expect().fail('Expected schema object');
    }
  });
});
