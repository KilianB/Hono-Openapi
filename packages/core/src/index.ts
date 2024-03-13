import { scalar } from '@hono-openapi/scalar';
import type { OpenApiRenderer } from '@hono-openapi/shared';
import { TObject, TSchema, TUnion, Type, TypeGuard } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { Context, Env, Schema } from 'hono';
import { Hono as HonoOriginal } from 'hono';
import { METHODS, METHOD_NAME_ALL_LOWERCASE } from 'hono/router';
import type {
  H,
  MergePath,
  MergeSchemaPath,
  Next,
  RouterRoute,
} from 'hono/types';
import fs from 'node:fs';
import { oas31 } from 'openapi3-ts';
import {
  isReferenceObject,
  type OpenAPIObject,
  type OpenApiBuilder,
  type ParameterObject,
  type PathItemObject,
  type ReferenceObject,
  type RequestBodyObject,
  type ResponseObject,
} from 'openapi3-ts/oas31';
import { parse as parseYaml } from 'yaml';
import { OpenApiMiddlewareFunction } from './middleware/openApiMiddleware';
import {
  jsonStringToTypeboxSchema,
  textStringToTypeboxSchema,
} from './typeboxUtils';
import {
  HttpMethod,
  OpenApiRouteDefinition,
  SampleResponseOptions,
  isOpenApiMiddleware,
  isPath,
  isValidHttpMethod,
  type HonoOpenApiOptions,
} from './types';

import {
  flattenIntersections,
  jsonSchemaToTypebox,
  mergeObjectSchemas,
} from './typesystem';
import { arrayify, deepCloneAndMerge, isDeepEqual, mergePath } from './utils';

export class Hono<
  E extends Env = Env,
  S extends Schema = {},
  BasePath extends string = '/'
> extends HonoOriginal<E, S, BasePath> {
  // extends ReplaceHandlerDefinitionBaseHonoClass<E, S, BasePath>
  // implements OpenApiRouteHandler
  #path: string = '/';
  openApiOptions: HonoOpenApiOptions<E>;

  public openApiBuilder: OpenApiBuilder;
  public openApiRenderer?: OpenApiRenderer;

  public openApiEndpoint: string | null = null;
  public openApiDefinitionEndpoint: string | null = null;

  public verbose: boolean = false;

  constructor(
    options: HonoOpenApiOptions<E> = {},
    openApiBuilder?: OpenApiBuilder
  ) {
    const {
      openApi,
      verbose,
      excludePaths,
      excludeMethod,
      ...baseHonoOptions
    } = options;
    super(baseHonoOptions);

    this.verbose = !!verbose;

    const openApiWithDefault: OpenAPIObject = {
      ...openApi,
      openapi: openApi?.openapi ?? '3.1.0',
      info: openApi?.info ?? {
        title: 'OpenApi Spec',
        version: '0.0.0',
      },
      components: openApi?.components ?? {},
    };

    this.openApiOptions = {
      ...options,
      excludePaths: arrayify(excludePaths),
      excludeMethod: arrayify(excludeMethod),
      openApi: openApiWithDefault,
    };

    if (openApiBuilder) {
      //Passed during clone constructor for .route  and basepath cloning
      this.openApiBuilder = openApiBuilder;
    } else {
      const specPath = this.openApiOptions.inSpecPath;
      if (specPath) {
        const isJson = specPath.endsWith('.json');
        const doc = fs.readFileSync(specPath, 'utf-8');

        let parsedDoc = isJson ? JSON.parse(doc) : parseYaml(doc);

        if (openApi) {
          //Extract custom keys
          const { endpoint, defaultTag, ...rest } = openApi;
          parsedDoc = deepCloneAndMerge(parsedDoc, rest);
        }
        this.openApiBuilder = oas31.OpenApiBuilder.create(parsedDoc);
      } else {
        this.openApiBuilder = new oas31.OpenApiBuilder(openApiWithDefault);
      }
    }

    // this.openApiOptions = openApi;

    // Auto mount GET endpoint on which the documentation will be served.
    if (openApiBuilder === undefined) {
      this.openApiEndpoint = openApi?.endpoint ?? '/swagger';
      this.openApiDefinitionEndpoint = `${this.openApiEndpoint}.json`;

      this.log(
        `API documentation is served at ${this.openApiEndpoint}. Spec file: ${this.openApiDefinitionEndpoint}`
      );

      //Register open api consumers by default
      this.openApiRenderer = scalar({
        spec: {
          url: this.openApiDefinitionEndpoint,
        },
      });

      this['addRoute']('get', this.openApiEndpoint, (c: Context<E>) => {
        return this.openApiRenderer!.serve({
          swaggerJsonUrl: this.openApiDefinitionEndpoint as string,
          context: c,
          renameModelCallback(oldName, newName, headingId) {
            throw new Error('Not yet implemented');
          },
        });
      });

      this['addRoute'](
        'get',
        `${this.openApiDefinitionEndpoint}`,
        (c: Context<E>) => {
          return c.text(this.openApiBuilder.getSpecAsJson(), 200, {
            'content-type': 'application/json',
          });
        }
      );
    }

    /**
     * Method called when a get post put, ... is called on the hono instance
     * forwarding the request to the actual user specified callbacks
     */
    const registerRouteHandler =
      (method: (typeof METHODS)[number] | 'all') =>
      (pathHandler: BasePath | H, ...args: H[]) => {
        let handlers: H[] = [];

        //We could do nesting ifs. Performance wise this doesn't make a difference, but for clarity sake keep it simple
        if (isPath(pathHandler)) {
          this.#path = pathHandler;
        } else {
          handlers.push(pathHandler);
        }

        const path = this.#path;

        handlers.push(...args);

        //Check if we got an openapi handler
        const openApiMiddlewareHandler = handlers.find((h) =>
          isOpenApiMiddleware(h)
        ) as OpenApiMiddlewareFunction | undefined;

        //Pass the hono options function back to the middleware. This is ugly and hacky. But oh well.
        if (openApiMiddlewareHandler) {
          openApiMiddlewareHandler.validationFunctionOption =
            this.openApiOptions.validationResponse;
        }

        //TODO take care of all
        //Listen to the response of the server and build the response schemas automatically

        //FIXME add exclude option

        if (
          (options.responseSampling ||
            openApiMiddlewareHandler?.responseSampling) &&
          method !== 'all'
          // &&
          // !this.isExcludedRoute(path)
        ) {
          this.log(
            'Register route handler open api middleware handler',
            openApiMiddlewareHandler
          );

          //Response Interception handler
          handlers.unshift(
            this.snoopOnResponseHandler(
              openApiMiddlewareHandler?.responseSampling
            ).bind(this)
          );
        }

        handlers.forEach((handler) => {
          this['addRoute'](method, path, handler);
        });

        return this as any;
      };

    // Implementation of app.get(...handlers[]) or app.get(path, ...handlers[])
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];

    allMethods.map((method) => {
      //Override base class of hono base
      this[method] = registerRouteHandler(method);
    });

    /**
     * Overwritten because merging of hono instances is calling this method?.
     *
     */
    this['addRoute'] = (method: string, path: string, handler: H) => {
      //passed values might be upper or lower case. Normalize it as we need both

      method = method.toLowerCase();
      const uppercaseMethod = method.toUpperCase();
      path = mergePath(this['_basePath'], path);

      //Just add the handler if path is not defined.
      if (isValidHttpMethod(method) && method !== 'all') {
        if (!this.isExcludedRoute(path, method)) {
          if (isOpenApiMiddleware(handler)) {
            //Replace opanapi definition
            this.addOrAugmentOpenApiRoute(
              method,
              path,
              handler.openApiData,
              handler.inferred
            );
          } else {
            //Add method stub.
            this.addOrAugmentOpenApiRoute(method, path);
          }
        }
      }

      const r: RouterRoute = {
        path: path,
        method: uppercaseMethod,
        handler: handler,
      };
      this.router.add(uppercaseMethod, path, [handler, r]);
      this.routes.push(r);
    };

    // We can not save openapi on exit. Bun has issues with the events below currently

    // process.on('exit', (code) => {
    //   console.log(`Process is exiting with code ${code}`);
    // });

    //Output openapi spec field on shutdown
    //   process.on('beforeExit', () => {
    //     console.log('On Before exit');
    //   });

    //   process.on('exit', () => {
    //     console.log('On exit');
    //   });

    //   //ctrl+c
    //   process.on('SIGINT', () => {
    //     console.log('SIGINT');
    //   });

    //   //pkill
    //   process.on('SIGUSR1', () => {
    //     console.log('SIGUSR1');
    //   });

    //   process.on('SIGUSR2', () => {
    //     console.log('SIGUSR2');
    //   });

    //   process.on('uncaughtException', () => {
    //     console.log('uncaughtException');
    //   });
    // }
  }

  basePath<SubPath extends string>(
    path: SubPath
  ): Hono<E, S, MergePath<BasePath, SubPath>> {
    const { getPath, router, strict, ...openApiHonoOptions } =
      this.openApiOptions;

    const shallowClonedInstance = new Hono(
      {
        ...super.basePath(path),
        ...openApiHonoOptions,
      },
      this.openApiBuilder
    );
    shallowClonedInstance.openApiRenderer = this.openApiRenderer;
    return shallowClonedInstance;
  }

  //We should just overwrite clone and be done with the routes and base endpoint. But this doesn't play along nicely with types
  // private clone(): HonoBase<E, S, BasePath> {
  //   const clone = new Hono<E, S, BasePath>({
  //     router: this.router,
  //     getPath: this.getPath,
  //   });

  //   clone.routes = this.routes;
  //   clone.openApiBuilder = this.openApiBuilder;
  //   clone.openApiRenderer = this.openApiRenderer;
  //   return clone as unknown as HonoBase<E, S, BasePath>;
  // }

  route<
    SubPath extends string,
    SubEnv extends Env,
    SubSchema extends Schema,
    SubBasePath extends string
  >(
    path: SubPath,
    app?: Hono<SubEnv, SubSchema, SubBasePath>
  ): Hono<
    E,
    MergeSchemaPath<SubSchema, MergePath<BasePath, SubPath>> & S,
    BasePath
  > {
    let documentEndpoint: RouterRoute[] | null = null;
    let uiEndpoint: RouterRoute[] | null = null;

    //Remote swagger routes if present. We do not need the nested entries.
    if (app instanceof Hono) {
      //Prev
      const definitionEndpointIndex = app.routes.findIndex(
        (r) => r.method === 'GET' && r.path === app.openApiDefinitionEndpoint
      );
      if (definitionEndpointIndex > -1) {
        documentEndpoint = app.routes.splice(definitionEndpointIndex, 1);
      }

      const uiEndpointIndex = app.routes.findIndex(
        (r) => r.method === 'GET' && r.path === app.openApiEndpoint
      );
      if (definitionEndpointIndex > -1) {
        uiEndpoint = app.routes.splice(uiEndpointIndex, 1);
      }

      if (app.openApiOptions.excludePaths !== undefined) {
        console.warn(
          'When using hono composition with app.route() the excludePaths option of the child will be ignored. The main instance is in charge of defining which route paths are displayed'
        );
      }
    }

    super.route(path, app);

    //Add them back again in case we want to mount them
    if (app instanceof Hono) {
      if (documentEndpoint !== null && documentEndpoint.length > 0) {
        app.routes.push(documentEndpoint[0]);
      }
      if (uiEndpoint !== null && uiEndpoint.length > 0) {
        app.routes.push(uiEndpoint[0]);
      }
    }

    return this;
  }

  /**
   * Add an entry about a route in the openapi spec document.
   * This needs to be called at least once for each endpoint.
   *
   * If a route definition already exists try to keep as much information
   * as possible from the old definition that can not automatically be inferred e.g.
   * summary, description, tags and response schemas. Those might have been manually added to the spec
   * file or were collected earlier.
   *
   * Request validation schemas are overwritten as the source of truth should always be the validator
   * function registered at the route.
   *
   * @param method
   * @param path
   * @param routeDefinition
   * @param validationSchema
   * @returns
   */
  protected addOrAugmentOpenApiRoute(
    method: (typeof METHODS)[number],
    path: string,
    routeDefinition?: OpenApiRouteDefinition,
    validationSchema?: OpenApiMiddlewareFunction['inferred']
  ) {
    const {
      description,
      summary,
      deprecated,
      tags,
      $ref,
      servers,
      externalDocs,
      security,
    } = routeDefinition ?? {};

    // /foo => Foo
    const capitalizedRoute = `${
      path.charAt(1).toUpperCase() + path.substring(2)
    }`;

    const operationId =
      routeDefinition?.operationId ?? `${method}${capitalizedRoute}`;

    //If one already exists ignore it
    const openApiRootDoc = this.openApiBuilder.getSpec();

    const existingSpec = openApiRootDoc.paths?.[path]?.[method];

    //Bail early if we already have a specification registered via an openapi middleware.
    //This happens because a different handler try to reregister this route and we would be loosing typing information by overwriting
    if (routeDefinition === undefined && existingSpec !== undefined) {
      return;
    }

    //Always replace the request objects. Source of truth are the validators

    let requestBody: RequestBodyObject | undefined = undefined;

    if (validationSchema?.json !== undefined) {
      requestBody = {
        content: {
          'application/json': {
            schema: {
              $ref: this.addBodyTypeToSchema(
                `${capitalizedRoute}Request_${method}`,
                validationSchema.json
              ),
            },
          },
        },
      };
    }

    let parameters: (ParameterObject | ReferenceObject)[] = [];

    const addParameter = (
      type: 'query' | 'cookie' | 'path' | 'header',
      typeSchema: TSchema | undefined
    ) => {
      if (typeSchema !== undefined) {
        const definition = typeSchema as TObject;
        const properties = definition.properties;

        //Check if this already exists in out store and use a ref instead?

        this.log(
          'Attempt to add new parameter to openapi doc.',
          'Existing parameters',
          openApiRootDoc.components?.parameters
        );

        Object.entries(properties).forEach(([name, schema]) => {
          const exampleIsArray = Array.isArray(schema.examples);
          const parameterObject: ParameterObject = {
            in: type,
            name: name,
            schema: schema,
            required: definition.required?.includes(name) ?? false,
            examples: exampleIsArray ? schema.examples : undefined,
            example: exampleIsArray === false ? schema.examples : undefined,
          };

          const parameterRef = this.addParameterToSchema(
            parameterObject,
            schema
          );

          parameters.push({
            $ref: parameterRef,
          });
        });
      }
    };

    addParameter('query', validationSchema?.query);
    addParameter('cookie', validationSchema?.cookie);
    addParameter('header', validationSchema?.header);

    if (validationSchema?.param !== undefined) {
      addParameter('path', validationSchema?.param);
    } else {
      if (path) {
        //Try to parse the path values from the base path e.g. /posts/:id/comment/:comment_id ;
        const regex = /\/:\w*/g;
        const paths = path.match(regex);
        if (paths !== null) {
          paths.forEach((p) => {
            parameters.push({
              in: 'path',
              name: p.substring(2),
              schema: Type.String(),
              required: true,
            });
          });
        }
      }
    }

    const addToApiBuilder = (method: string) => {
      let pathInfo: PathItemObject = {
        $ref,
        servers: servers ?? existingSpec?.servers,
        [method]: {
          summary: summary ?? existingSpec?.summary,
          description: description ?? existingSpec?.description,
          deprecated: deprecated ?? existingSpec?.deprecated,
          tags:
            tags ?? this.openApiOptions.openApi?.defaultTag
              ? [this.openApiOptions.openApi?.defaultTag]
              : undefined,
          externalDocs: externalDocs ?? existingSpec?.externalDocs,
          operationId,
          requestBody: requestBody,
          parameters: parameters,
          security: security ?? existingSpec?.security,
          //Try to keep
          responses: existingSpec?.responses ?? {},
        },
      };
      this.openApiBuilder.addPath(path, pathInfo);
    };

    addToApiBuilder(method);
  }

  /**
   * Saves the current openapi documentation to a file.
   * If no file extension is used a yaml format will be used.
   * If a .json exension is supplied the doc will be saved as json
   *
   * @param filePath absolute or relative path to save the file.
   */
  saveOpenAPI31Document = (filePath: fs.PathOrFileDescriptor) => {
    const isJsonExtension = filePath.toString().endsWith('.json');
    fs.writeFileSync(
      filePath,
      isJsonExtension
        ? this.openApiBuilder.getSpecAsJson()
        : this.openApiBuilder.getSpecAsYaml()
    );
  };

  //Mirror zod-openapi endpoints
  getOpenAPI31Document = () => {
    return this.openApiBuilder.getSpec();
  };

  /**
   * Set the current renderer used to display the spec file
   * @param renderer Plugin consuming the opanapi json file and displaying it to the user
   */
  registerOpenApiRenderer(renderer: OpenApiRenderer) {
    this.openApiRenderer = renderer;
  }

  // openApiRefMap = new Map<TSchema,string>();

  /**
   * Adds a new parameter to the openapi spec doc and return the reference that can be used.
   * If an identical parameter has already been added the previous parameter will be returned instead.
   *
   * @param parameter description of the parameter to add
   * @param schema typebox schema definition of values
   * @returns ref id of openapi components/parameter section
   */
  protected addParameterToSchema(parameter: ParameterObject, schema: TSchema) {
    if (schema.open_api_ref?.[parameter.in] !== undefined) {
      return schema.open_api_ref[parameter.in] as string;
    }

    let parameters = this.openApiBuilder.getSpec().components!.parameters;
    if (parameters === undefined) {
      parameters = {};
      this.openApiBuilder.getSpec().components!.parameters = parameters;
    }

    //Check if a parameter with that name already exists
    let name: string | null = null;
    let curName = `${parameter.name}_${parameter.in}`;

    for (let i = 0; i < 2000; i++) {
      if (parameters[curName]) {
        //Parameter with name exists
        const deepEqual = isDeepEqual(parameter, parameters[curName], [
          'open_api_ref',
        ]);
        if (deepEqual) {
          return `#/components/parameters/${curName}`;
        } else {
          //Retry with slightly different name
          curName = `${parameter.name}_${parameter.in}${i}`;
        }
      } else {
        name = curName;
        break;
      }
    }

    if (name === null) {
      throw new Error(
        'Should never happen. 2000 Parameters with same name and no duplicate registered?'
      );
    }
    parameter.schema = Type.Strict(schema);

    const parameterCopy = {
      ...parameter,
      schema: {
        ...Type.Strict(schema),
      },
    };

    delete parameterCopy.schema.open_api_ref;

    //Add the open_api_ref to the schema, so if it is reused again later we can just reference it.
    //For parameters this only works if we use the same
    this.openApiBuilder.addParameter(name, parameterCopy);

    if (!schema.open_api_ref) {
      schema.open_api_ref = {};
    }

    schema.open_api_ref[parameter.in] = `#/components/parameters/${name}`;

    return `#/components/parameters/${name}`;
  }

  protected addBodyTypeToSchema(name: string, schema: TSchema) {
    if (schema.open_api_ref?.body !== undefined) {
      return schema.open_api_ref.body;
    }

    //Add it to the document.
    this.openApiBuilder.addSchema(name, Type.Strict(schema));

    if (!schema.open_api_ref) {
      schema.open_api_ref = {};
    }

    schema.open_api_ref.body = `#/components/schema/${name}`;
    return `#/components/schemas/${name}`;
  }

  /**
   * Handler to spy on responses send by the webserver to infer the response type schema automatically.
   */
  protected snoopOnResponseHandler(
    handlerSampleOptions?: SampleResponseOptions
  ) {
    return async function (
      this: typeof Hono.prototype,
      c: Context<Env, BasePath, any>,
      next: Next
    ) {
      //Interception handler
      await next();

      const STATUS_CODE_MAP: Record<number, string> = {
        200: 'Success',
        400: 'Validation Error',
        403: 'Forbidden',
        404: 'Not Found',
        418: "I'm a teampot",
        500: 'Internal Server Error',
        504: 'Gateway Timeout',
      };

      // routePath: /account/:id  c.req.path: /account/102
      const path = c.req.routePath; //c.req.path;
      const method = c.req.method.toLowerCase() as (typeof METHODS)[number];

      let inferredSchema: TSchema | undefined = undefined;

      //text/html; charset=UTF-8
      let contentType = c.res.headers.get('content-type');
      const charsetSeparator = contentType?.indexOf(';');
      if (charsetSeparator !== undefined && charsetSeparator > 0) {
        contentType = contentType!.substring(0, charsetSeparator);
      }

      //c.text() adds no content type.
      if (contentType === null) {
        contentType = 'text/html';
      }

      const statusCode = c.res.status;
      const rootDoc = this.openApiBuilder.getSpec();

      const pathObject = rootDoc.paths?.[path];

      //Replace all / or scalar will have issues
      const prettyName = `${path.charAt(1).toUpperCase()}${path.substring(
        2
      )}Response_${method}_${contentType}_${statusCode}`.replaceAll(/\//g, '_');

      //Check ahead of time how quickly we should bail. This will be much more performant if we do not need to actually look deep.

      // Most important are handler overrides.

      const gSampleOptions = this.openApiOptions.responseSampling;

      const sampleInterval =
        handlerSampleOptions?.samplingInterval ??
        gSampleOptions?.samplingInterval ??
        1;
      const maxResponsesToSample =
        handlerSampleOptions?.samplingMaxCount ??
        gSampleOptions?.samplingMaxCount ??
        Infinity;

      /** Number of responses that were already processed for this response path */
      const sampledCount: number | null =
        pathObject?.[method]?.responses?.[statusCode]?.content?.[contentType]
          ?.schema?.['x-openapi-sample-count'] ?? null;

      //Always sample when we have no responses yet
      if (
        sampledCount !== null &&
        (sampledCount >= maxResponsesToSample || Math.random() > sampleInterval)
      ) {
        this.log(
          'Bail. Sample goal reached',
          contentType,
          prettyName,
          statusCode,
          'Sample count: ',
          sampledCount,
          'Max Sample Count',
          maxResponsesToSample,
          'Sample Interval',
          sampleInterval
        );
        return;
      }

      const response = c.res.clone().body;
      let responseData: string | object = '';

      if (response !== null) {
        responseData = await Bun.readableStreamToText(response);
        if (contentType === 'application/json') {
          inferredSchema = jsonStringToTypeboxSchema(responseData);
          responseData = JSON.parse(responseData);
        } else if (
          contentType === 'text/html' ||
          contentType === 'text/plain'
        ) {
          inferredSchema = textStringToTypeboxSchema(responseData);
        } else if (contentType === null && responseData.length > 0) {
          contentType = 'text/html';
          inferredSchema = textStringToTypeboxSchema(responseData);
        }
      }

      this.log(
        'status code of response',
        statusCode,
        'content type',
        contentType,
        'schema',
        inferredSchema
      );

      if (pathObject && contentType && inferredSchema) {
        const methodObj = pathObject[method]?.responses;
        if (methodObj) {
          const statusCodeObj: ResponseObject | ReferenceObject | undefined =
            methodObj[statusCode];
          if (statusCodeObj) {
            //Status code already known. We had a response like this before
            if ('content' in statusCodeObj) {
              const contentTypeObj = statusCodeObj.content![contentType];

              if (contentTypeObj === undefined) {
                this.log(
                  'No response with content type before. Create new schema object',
                  contentType,
                  prettyName,
                  statusCode
                );

                const schemaRef = this.addBodyTypeToSchema(
                  prettyName,
                  inferredSchema
                );

                statusCodeObj.content![contentType] = {
                  schema: {
                    $ref: schemaRef,
                    'x-openapi-sample-count': 1,
                  },
                };

                this.log(
                  'Status code object added',
                  statusCodeObj.content![contentType]
                );

                //Add this one as an example
                // this.openApiBuilder.addPath(path, {
                //   [method]: {
                //     responses: {
                //       200: {
                //         description: '',
                //         content: {
                //           [contentType]: {
                //             schema: inferredSchema,
                //           },
                //         },
                //       },
                //     },
                //   },
                // });
              } else {
                this.log(
                  'Response already present. Attempt to merge with existing definitions'
                );

                if (isReferenceObject(contentTypeObj.schema)) {
                  const refId = contentTypeObj.schema.$ref.substring(
                    '#/components/schemas/'.length
                  );
                  const refSchema = rootDoc.components?.schemas;
                  const typeboxRefSchema = jsonSchemaToTypebox(
                    refSchema![refId]
                  );
                  const responsesEqual = isDeepEqual(
                    typeboxRefSchema,
                    inferredSchema,
                    ['example']
                  );

                  //Or can we simply check if it applies?

                  this.log('Attempt to merge id', refId);
                  this.log('Inferred typebox schema', inferredSchema);
                  this.log('Ref json schema', refSchema![refId]);
                  this.log('Ref typebox schemas', typeboxRefSchema);
                  this.log('Definition matches', responsesEqual);

                  if ('x-openapi-sample-count' in contentTypeObj.schema) {
                    contentTypeObj.schema['x-openapi-sample-count'] =
                      (contentTypeObj.schema[
                        'x-openapi-sample-count'
                      ] as number) + 1;
                  } else {
                    //@ts-expect-error extensions not properly typed? Or are they not allowed here? It's working though.
                    //This branch should never be hit anyways
                    contentTypeObj.schema['x-openapi-sample-count'] = 1;
                  }

                  if (responsesEqual) {
                    this.log(
                      'Skip updating response schema due to definition equality'
                    );
                    return;
                  }

                  const valueMatch = Value.Check(
                    typeboxRefSchema,
                    responseData
                  );

                  //The old definition might match if we have additional values..
                  //How do we prevent

                  //Why is that a good idea?
                  if (valueMatch) {
                    this.log(
                      'Skip updating response schema due to value equality'
                    );
                    return;
                  }

                  //Check the mode

                  const samplingMethod =
                    handlerSampleOptions?.samplingMode ??
                    gSampleOptions?.samplingMode ??
                    'individual';

                  if (samplingMethod === 'combine') {
                    this.log('Replace current definition with combine');
                    const mergedSchema = flattenIntersections(
                      mergeObjectSchemas([typeboxRefSchema, inferredSchema])
                    );
                    //Replace current existing one;
                    refSchema![refId] = Type.Strict(mergedSchema);
                  } else if (samplingMethod === 'individual') {
                    this.log('Replace current definition with individual');

                    //Create a union if we don't already have a union.

                    let mergedSchema: TUnion;

                    if (TypeGuard.IsUnion(typeboxRefSchema)) {
                      mergedSchema = typeboxRefSchema;
                      mergedSchema.anyOf.push(inferredSchema);
                    } else {
                      mergedSchema = Type.Union([
                        typeboxRefSchema,
                        inferredSchema,
                      ]);
                    }

                    refSchema![refId] = Type.Strict(mergedSchema);
                  }
                } else {
                  console.warn(
                    'Non reference schema object found in response schema. Merging is currently not supported',
                    contentType,
                    prettyName,
                    statusCode
                  );
                }
              }
            }
          } else {
            this.log('Status code does not exist. Create it', statusCode);
            const schemaRef = this.addBodyTypeToSchema(
              prettyName,
              inferredSchema
            );
            //Create it unknown status code. Not sure if merging really works. But we will see
            methodObj[statusCode] = {
              //TODO We should also allow users to supply a description here via the openApiMiddleware
              description: STATUS_CODE_MAP[statusCode] ?? '',
              content: {
                [contentType]: {
                  schema: {
                    $ref: schemaRef,
                    'x-openapi-sample-count': 1,
                  },
                },
              },
            };
          }
        } else {
          //Create it. Does not have method. Should never happen. This is registered during initial setup
          this.log('Method does not exist. This should never happen');
        }
      } else {
        //Create it from scratch. completely unknown. Should never happen
        this.log(
          'Path object not known or inferred schema is empty',
          'Content Type',
          contentType,
          'Path Object',
          pathObject,
          'Inferred Schema',
          inferredSchema
        );
      }
    }.bind(this);
  }

  log(message: string, ...args: any[]) {
    if (this.verbose) {
      console.log(message, ...args);
    }
  }

  /**
   * Check if a supplied route
   * @param path as used during route registration
   * @returns true if the route
   */
  public isExcludedRoute(
    path: string,
    method: HttpMethod | typeof METHOD_NAME_ALL_LOWERCASE
  ) {
    if (
      this.openApiOptions.excludeMethod &&
      Array.isArray(this.openApiOptions.excludeMethod)
    ) {
      if (this.openApiOptions.excludeMethod.includes(method as any)) {
        return true;
      }
    }

    if (
      Array.isArray(this.openApiOptions.excludePaths) ||
      this.openApiOptions.excludePaths === undefined
    ) {
      return this.openApiOptions.excludePaths?.some((strOrReg) => {
        if (typeof strOrReg === 'string') {
          return path === strOrReg;
        } else {
          return strOrReg.test(path);
        }
      });
    } else {
      throw new Error(
        'Excluded paths should be an array. This behavior is enforced in the constructor. Code path should never happen.'
      );
    }
  }
}

export * from '@hono-openapi/shared';
export * from './middleware/openApiMiddleware';
export * from './types';
