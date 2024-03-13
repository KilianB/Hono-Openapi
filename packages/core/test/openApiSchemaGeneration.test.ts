import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import { ParameterObject, isSchemaObject } from 'openapi3-ts/oas31';
import { parse as yamlParse } from 'yaml';
import { Hono } from '../src/index';
import { openApi } from '../src/middleware/openApiMiddleware';
import {
  flattenIntersections,
  jsonSchemaToTypebox,
  mergeObjectSchemas,
} from '../src/typesystem';

describe('Component refs', () => {
  it('schema does not contain custom keywords', async () => {
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
    const doc = app.getOpenAPI31Document();

    const parameterSchema = Object.values(doc.components?.parameters ?? {});

    expect(parameterSchema.length).toBeGreaterThan(0);

    parameterSchema.forEach((p) => {
      const keys = Object.keys((p as ParameterObject).schema ?? []).sort();
      expect(keys).toStrictEqual(['examples', 'type']);
    });
  });

  it('header schema creates a single property', async () => {
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
      (c) => c.text('OK')
    );
    const doc = app.getOpenAPI31Document();

    const parameterSchema = Object.values(doc.components?.parameters ?? {});

    expect(parameterSchema.length).toBe(1);
  });

  it('duplicated schema in header and query are created individually', async () => {
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
    const doc = app.getOpenAPI31Document();

    expect(Object.keys(doc.components?.parameters ?? {})).toBeArrayOfSize(2);
  });

  //Implementation changed. check how to fix this test
  it.skip('Reuse existing schemas by deep equality', async () => {
    const app = new Hono({
      openApi: {
        info: {
          title: 'App',
          version: '0.0.1',
        },
      },
    });

    const languageCodeSchema = Type.Object({
      languageCode: Type.String({
        examples: 'de',
      }),
    });

    const languageCodeSchema1 = Type.Object({
      languageCode: Type.String({
        examples: 'de',
      }),
    });

    app.get(
      '/foo',
      openApi({
        query: languageCodeSchema,
        description: 'Retrieve foo',
        summary: 'My own summary',
      }),
      (c) => c.text('ok')
    );

    app.get(
      '/bar',
      openApi({
        query: languageCodeSchema1,
      }),
      (c) => c.text('ok')
    );

    const openApiDoc = app.getOpenAPI31Document();

    expect(openApiDoc.components).toBeDefined();
    expect(openApiDoc.components!.parameters).toBeDefined();

    expect(
      Object.keys(openApiDoc.components!.parameters ?? [])
    ).toBeArrayOfSize(1);

    //@ts-expect-error
    expect(openApiDoc.paths['/foo'].get!.parameters[0].$ref).toBe(
      '#/components/parameters/languageCode'
    );
    //@ts-expect-error
    expect(openApiDoc.paths['/bar'].get!.parameters[0].$ref).toBe(
      '#/components/parameters/languageCode'
    );
  });

  it('Reuse of schemas uses same reference', async () => {
    //We have different examples so we expect 2 different schemas to be generated.
    //But not 3 because one got recreated

    const app = new Hono({
      openApi: {
        info: {
          title: 'App',
          version: '0.0.1',
        },
      },
    });

    const languageCodeSchema = Type.Object({
      languageCode: Type.String({
        examples: 'de',
      }),
    });

    const languageCodeSchema1 = Type.Object({
      languageCode: Type.String({
        examples: 'en',
      }),
    });

    app.get(
      '/foo',
      openApi({
        query: languageCodeSchema,
        description: 'Retrieve foo',
        summary: 'My own summary',
      }),
      (c) => c.text('ok')
    );

    app.get(
      '/baz',
      openApi({
        query: languageCodeSchema1,
      }),
      (c) => c.text('ok')
    );

    app.get(
      '/bar',
      openApi({
        query: languageCodeSchema1,
      }),
      (c) => c.text('ok')
    );

    const openApiDoc = app.getOpenAPI31Document();

    expect(openApiDoc.components).toBeDefined();
    expect(openApiDoc.components!.parameters).toBeDefined();

    expect(
      Object.keys(openApiDoc.components!.parameters ?? [])
    ).toBeArrayOfSize(2);

    expect(
      //@ts-expect-error no narrowing on types
      openApiDoc.components!.parameters!['languageCode_query'].example
    ).toBe('de');
    expect(
      //@ts-expect-error no narrowing on types
      openApiDoc.components!.parameters!['languageCode_query0'].example
    ).toBe('en');

    //@ts-expect-error
    expect(openApiDoc.paths['/foo'].get!.parameters[0].$ref).toBe(
      '#/components/parameters/languageCode_query'
    );
    //@ts-expect-error
    expect(openApiDoc.paths['/bar'].get!.parameters[0].$ref).toBe(
      '#/components/parameters/languageCode_query0'
    );
    //@ts-expect-error
    expect(openApiDoc.paths['/baz'].get!.parameters[0].$ref).toBe(
      '#/components/parameters/languageCode_query0'
    );
  });

  it('Individual responses', async () => {
    const app = new Hono({
      responseSampling: {
        samplingMode: 'individual',
      },
    });

    //Generate 2 almost identical schemas with different examples. This does not generate a separate schema

    let i = 0;

    app.get('/schema1', (c) => {
      {
        if (i == 0) {
          i++;
          return c.json({ a: 'schema1.a', b: 'schema1.b' });
        }
        return c.json({ a: 'schema1.b', b: 'schema1.ff' });
      }
    });

    const r0 = await (await app.request('/schema1')).json();
    const r1 = await (await app.request('/schema1')).json();

    expect(r0).toMatchObject({ a: 'schema1.a', b: 'schema1.b' });
    expect(r1).toMatchObject({ a: 'schema1.b', b: 'schema1.ff' });

    const doc = app.getOpenAPI31Document().components?.schemas ?? {};
    expect(Object.keys(doc)).toBeArrayOfSize(1);

    const schema = doc[Object.keys(doc)[0]];

    //No any of generated
    if (isSchemaObject(schema)) {
      expect(schema.type).toBe('object');
    } else {
      expect().fail('Schema object is undefined');
    }
  });

  it('Individual responses get combined into single any of ', async () => {
    const app = new Hono({
      responseSampling: {
        samplingMode: 'individual',
      },
    });

    //Generate 2 almost identical schemas with different examples. This does not generate a separate schema

    let i = 0;

    app.get('/schema1', (c) => {
      {
        i++;
        if (i == 1) {
          return c.json({ a: 'schema1.a', b: 'schema1.b' });
        }
        if (i == 2) {
          return c.json({ c: 'schema1.b', b: 'schema1.ff' });
        }
        return c.json({ d: 'schema1.e' });
      }
    });

    const r0 = await (await app.request('/schema1')).json();
    const r1 = await (await app.request('/schema1')).json();
    const r2 = await (await app.request('/schema1')).json();

    expect(r0).toMatchObject({ a: 'schema1.a', b: 'schema1.b' });
    expect(r1).toMatchObject({ c: 'schema1.b', b: 'schema1.ff' });
    expect(r2).toMatchObject({ d: 'schema1.e' });

    const doc =
      app.getOpenAPI31Document().components?.schemas?.[
        'Schema1Response_get_application_json_200'
      ] ?? {};

    if (isSchemaObject(doc)) {
      expect(doc.anyOf).toBeArrayOfSize(3);
    } else {
      expect().fail('Expected schema object');
    }

    console.log(doc);
    // expect(Object.keys(doc)).toBeArrayOfSize(1);

    // const schema = doc[Object.keys(doc)[0]];

    // //No any of generated
    // if (isOpenApiSchema(schema)) {
    //   expect(schema.type).toBe('object');
    // } else {
    //   expect().fail('Schema object is undefined');
    // }
  });

  it.skip('Merge schema', async () => {
    const app = new Hono({
      responseSampling: {
        samplingMode: 'combine',
      },
    });

    //Generate 2 almost identical schemas with different examples
    app.get('/schema1', (c) => {
      return c.json({ a: 'schema1.a', b: 'schema1.b' });
    });

    app.get('/schema2', (c) => {
      return c.json({ a: 'schema2.a', c: 'schema2.c' });
    });

    await app.request('schema1');
    await app.request('schema2');

    // union [schema 1 or schema 2];
    // intersect [schema1 and schema2];

    const doc = app.getOpenAPI31Document();

    console.log(doc);

    const schema1 =
      doc.components?.schemas?.['Schema1Response_get_application_json_200'];
    const schema2 =
      doc.components?.schemas?.['Schema2Response_get_application_json_200'];

    if (schema1 && schema2 && isSchemaObject(schema1) && isSchemaObject(schema2)) {
      // const mergedType = Type.Union([schema1 as TSchema, schema2 as TSchema]);
      // const b: Static<typeof mergedType> = {};

      const schema1Typebox = jsonSchemaToTypebox(schema1); //await schema2typebox({ input: JSON.stringify(schema1)});
      const schema2Typebox = jsonSchemaToTypebox(schema2); //await schema2typebox({ input: JSON.stringify(schema1)});

      console.log(schema1Typebox);
      console.log(schema2Typebox);

      const mergedType = mergeObjectSchemas([schema1Typebox, schema2Typebox]);
      const flattened = flattenIntersections(mergedType);

      console.log('Merged and flattened result', flattened);
    } else {
      expect().fail('schemas should not be undefined');
    }
  });

  it('path params generate response schema', async () => {
    const app = new Hono({
      responseSampling: {
        samplingMode: 'individual',
        samplingMaxCount: 10,
        samplingInterval: 1,
      },
    });

    const accountPathSchema = Type.Object({
      id: Type.Number(),
    });

    app.get(
      '/account/:id',
      openApi({
        param: accountPathSchema,
      }),
      async (c) => {
        return c.json({});
      }
    );

    await app.request('/account/102');

    expect(
      app.getOpenAPI31Document()?.paths?.['/account/:id']?.get?.responses?.[
        '200'
      ]
    ).toBeDefined();
  });

  it('response with different schemas do not overwrite existing response', async () => {
    const app = new Hono({
      responseSampling: {
        samplingMode: 'individual',
        samplingMaxCount: 10,
        samplingInterval: 1,
      },
    });

    const accountPathSchema = Type.Object({
      id: Type.Number(),
    });

    app.get(
      '/account/:id',
      openApi({
        param: accountPathSchema,
      }),
      async (c) => {
        const { id } = c.req.valid('param');

        if (id === 0) {
          return c.text('Sorry. You are not permitted to access account id 0');
        }

        if (id > 100) {
          return c.json({
            id: id,
            name: 'Smith',
            balance: Math.random(),
          });
        } else {
          return c.json({
            id: id,
            balance: Math.random(),
            premiumFeatures: {
              overdraftProtection: true,
              secondCard: false,
            },
          });
        }
      }
    );

    await app.request('/account/102');
    await app.request('/account/5');
    await app.request('/account/0');

    const responses =
      app.getOpenAPI31Document()?.paths?.['/account/:id'].get?.responses?.[200]
        ?.content;

    if (responses === undefined) {
      expect().fail('Response object should be defined');
    } else {
      const json = responses['application/json'].schema.$ref;
      const text = responses['text/html'].schema.$ref;

      expect(json).toBeDefined();
      expect(text).toBeDefined();
      expect(json).not.toEqual(text);
    }
  });

  it('response with different status codes do not overwrite existing response', async () => {
    const app = new Hono({
      responseSampling: {
        samplingMode: 'individual',
        samplingMaxCount: 10,
        samplingInterval: 1,
      },
    });

    const accountPathSchema = Type.Object({
      id: Type.Number(),
    });

    app.get(
      '/account/:id',
      openApi({
        param: accountPathSchema,
      }),
      async (c) => {
        const { id } = c.req.valid('param');

        if (id === 0) {
          return c.json({ hello: 'world' }, 200);
        }

        return c.json({ hello: 'world' }, 401);
      }
    );

    await app.request('/account/0');
    await app.request('/account/5');

    const responses =
      app.getOpenAPI31Document()?.paths?.['/account/:id'].get?.responses;

    if (responses) {
      const success = responses['200']?.content?.['application/json'];
      const fail = responses['401']?.content?.['application/json'];

      expect(success).toBeDefined();
      expect(fail).toBeDefined();

      expect(success.schema.$ref).not.toEqual(fail.schema.$ref);
    } else {
      expect().fail('responses should be defined');
    }
  });

  it('generates schema for text only and non 200', async () => {
    const app = new Hono({
      responseSampling: {
        samplingMode: 'individual',
        samplingMaxCount: 10,
        samplingInterval: 1,
      },
    });

    app.get('/test', async (c) => c.text('OK', 401));

    await app.request('/test');

    expect(
      app.getOpenAPI31Document().paths?.['/test']?.get?.responses?.['401']
    ).toBeDefined();
  });

  it('custom schema gets expanded correctly', async () => {
    const definitionFile = yamlParse(
      await fs.readFileSync('./packages/core/test/resources/spec.yaml', 'utf-8')
    );

    const payloadWithAdditionalProperty = {
      lat: 50.93,
      lng: 7,
      newProperty: true,
      name: 'Cologne',
      locode: 'DE CGN',
    };

    const jsonSchema = definitionFile.components.schemas.LocationResponse;
    const typeboxRefSchema = jsonSchemaToTypebox(jsonSchema);
    expect(
      Value.Check(typeboxRefSchema, payloadWithAdditionalProperty)
    ).toBeFalse();
  });
});
