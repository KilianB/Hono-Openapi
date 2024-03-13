import { ValueError } from '@sinclair/typebox/errors';
import { Context } from 'hono';
import type { HonoOptions } from 'hono/hono-base';
import { METHODS, METHOD_NAME_ALL_LOWERCASE } from 'hono/router';
import type { Env, H } from 'hono/types';
import { StatusCode } from 'hono/utils/http-status';
import type {
  OpenAPIObject,
  OperationObject,
  PathItemObject,
} from 'openapi3-ts/oas31';
import { OpenApiMiddlewareFunction } from './middleware/openApiMiddleware';

export type HttpMethod = (typeof METHODS)[number];

export type OpenApiRouteDefinition = Omit<
  PathItemObject,
  | 'get'
  | 'put'
  | 'post'
  | 'delete'
  | 'options'
  | 'head'
  | 'patch'
  | 'trace'
  | 'parameters'
> &
  Partial<Omit<OperationObject, 'requestBody' | 'parameters'>>;

export interface ExtendedOpenApiHonoOptions extends Partial<OpenAPIObject> {
  /**
   *  Path which will be used to serve the swagger documentation. /swagger by default if not specified. */
  endpoint?: string;

  /** Default Tag that will be applied to all routes added to this hono instance */
  defaultTag?: string;
}

/**
 * Analyze the response sent for an endpoint and try to automatically create response definitions.
 * In order to introspect the response returned by the web server the response packages are cloned
 * which might lead to a performance penalty.
 *
 * This mode attempts to generate responds schemas which are visible in real time in the openai schema.
 * Due to the nature of ambiguity, different response could
 *
 * @experimental
 */
export interface SampleResponseOptions {
  /**
     * Define how types are build when the response schema does not match up 
     * 
     * For incoming request
     * 1:  {a: 1, b: 'foo'}
     * 2:  {a: 2, c: 'bar'}
     * 
     * | Mode             | Result type                                       |
     * | :--------------- | :-----------------------------------------------  | 
     * | combine          | {a: number, b?: string, c?: string}               |
     * | separate         | {a: number, b: string} | { a: number, c: string}  |
     * | smart            | attempt to diff in a smart way and check how much percentage of responses are individual |  

     */
  samplingMode: 'combine' | 'individual';
  /**
   * [0-1] Which fractions of responses should be taken a look at.
   * A value of 1 means that every response will be inspected, a
   * value of 0.1 means 10% of responses are sampled.
   *
   * Sampling responses will
   *
   */
  samplingInterval?: number;
  /**
   * Maximum number of responses for each endpoint
   */
  samplingMaxCount?: number;
}

export type ValidationCallback = (
  c: Context,
  validationErrors: Record<string, ValueError[]>
) => Promise<Response | void> | Response | void;

export interface ValidationResponseType {
  /**
   * http error code to send in case of a response validation error
   * If validationCallback is returning a response this property is ignored.
   */
  errorCode?: StatusCode;
  /**
   * Callback that is invoked in case of a response validation error.
   * This method should return a response that will be returned to the client
   * instead of the original response.
   *
   * Here is the place to add logging to figure out what went wrong.
   * @param c Context
   * @returns if a response is returned it will be returned instead of the default generated response. This will overwrite the supplied errorCode
   */
  validationCallback?: ValidationCallback;
}

export interface HonoOpenApiOptions<E extends Env> extends HonoOptions<E> {
  openApi?: ExtendedOpenApiHonoOptions;

  /**
   * Customize the response send to the caller in case validation fails.
   */
  validationResponse?: ValidationResponseType;

  responseSampling?: SampleResponseOptions;

  /**
   * routes to exclude from appearing in the swagger documentation.
   * When a string is supplied the path has to exactly match.
   *
   * When using `app.route()` only the main instance settings are regarded
   *
   * @example
   *   /foo         | exactly route /foo is excluded
   *   /public/foo  |
   *   /foo/        | all routes that include foo somewhere in the path are excluded
   */
  excludePaths?: (string | RegExp)[] | string | RegExp;

  /**
   * Do not include routes with the given http verb
   *
   * @example
   *  "OPTIONS"
   */
  excludeMethod?: HttpMethod | HttpMethod[];

  /**
   * File path to a openapi definition document which will be used
   * as a starting point and dynamically expended.
   * All routes defined will be added to this file and overwritten if an openapi middleware handler
   * with conflicting definitions exist.
   *
   * This setting is useful if you want to reuse already generated response types from
   * a previous run.
   *
   * @example
   *  ./swagger.json
   *  ./swagger       | will assume .yaml
   *  ./swagger.yaml
   */
  inSpecPath?: string;

  /**
   * @deprecated not yet implemented. Automatically save the openapi doc on exit.
   * Current issue is that process.on('exit') sigint beforexit ... is not reliably working in bun.
   * As an alternative implement this functionality yourself by calling `app.saveOpenAPI31Document`
   */
  outSpecPath?: string;

  verbose?: boolean;
}

export const isValidHttpMethod = (
  method: string
): method is (typeof METHODS)[number] | typeof METHOD_NAME_ALL_LOWERCASE => {
  return method === 'all' || METHODS.includes(method as any);
};

export const isPath = <P extends String>(
  toCheck: P | OpenApiRouteDefinition | H
): toCheck is P => {
  return typeof toCheck === 'string';
};

export const isOpenApiMiddleware = (
  handler: H | undefined
): handler is OpenApiMiddlewareFunction => {
  return handler !== undefined && 'openApiData' in handler;
};
