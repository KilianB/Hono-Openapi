// import {
//   Static,
//   Type,
//   TSchema,
// } from '../../../node_modules/@sinclair/typebox/build/import/index.mjs';
// import { Value, type ValueError } from '@sinclair/typebox/value';
// import type {
//   Context,
//   Env,
//   MiddlewareHandler,
//   ValidationTargets,
//   Next,
// } from 'hono';
// import { validator } from 'hono/validator';

// export interface LowerCaseTSchema
//   extends Pick<
//     TSchema,
//     | 'static'
//     | 'params'
//     | '$schema'
//     | '$id'
//     | 'title'
//     | 'description'
//     | 'default'
//     | 'examples'
//     | 'readOnly'
//     | 'writeOnly'
//   > {
//   open_api_ref?: {
//     body?: string;
//     path?: string;
//     query?: string;
//     header?: string;
//     cookie?: string;
//   };

//   [Kind]: string;
//   [ReadonlyKind]?: string;
//   [OptionalKind]?: string;
//   [Hint]?: string;

//   [prop: Lowercase<string>]: any;
// }

import { Static, TSchema, TypeGuard } from '@sinclair/typebox';
import { Value, ValueError, ValueErrorType } from '@sinclair/typebox/value';
import { Env, Input, MiddlewareHandler, ValidationTargets } from 'hono';
import { validator } from 'hono/validator';
import {
  OpenApiRouteDefinition,
  SampleResponseOptions,
  ValidationResponseType,
} from '..';

type OptionalProperty<
  T extends TSchema | undefined,
  K extends keyof ValidationTargets
> = T extends undefined ? {} : { [P in K]: T };

type ConvertToStaticType<T> = {
  [key in keyof T]: T[key] extends TSchema ? Static<T[key]> : never;
};

export interface OpenApiProperties<
  JsonSchema extends TSchema | undefined,
  QuerySchema extends TSchema | undefined,
  ParamSchema extends TSchema | undefined,
  HeaderSchema extends TSchema | undefined,
  FormSchema extends TSchema | undefined,
  CookieSchema extends TSchema | undefined
> extends OpenApiRouteDefinition {
  json?: JsonSchema;
  query?: QuerySchema;
  form?: FormSchema;
  cookie?: CookieSchema;
  header?: HeaderSchema;
  param?: ParamSchema;
}

export type OpenApiMiddlewareFunction<
  E extends Env = any,
  P extends string = string,
  I extends Input = {}
> = MiddlewareHandler<E, P, I> & {
  openApiData: OpenApiRouteDefinition;
  validationFunctionOption?: ValidationResponseType;
  responseSampling?: SampleResponseOptions;
  inferred: {
    json?: TSchema;
    query?: TSchema;
    form?: TSchema;
    cookie?: TSchema;
    header?: TSchema;
    param?: TSchema;
  };
};

export function openApi<
  JsonSchema extends TSchema | undefined,
  QuerySchema extends TSchema | undefined,
  ParamSchema extends TSchema | undefined,
  HeaderSchema extends TSchema | undefined,
  FormSchema extends TSchema | undefined,
  CookieSchema extends TSchema | undefined,
  E extends Env,
  P extends string,
  V extends {
    in: OptionalProperty<JsonSchema, 'json'> &
      OptionalProperty<QuerySchema, 'query'> &
      OptionalProperty<ParamSchema, 'param'> &
      OptionalProperty<HeaderSchema, 'header'> &
      OptionalProperty<FormSchema, 'form'> &
      OptionalProperty<CookieSchema, 'cookie'>;
    out: ConvertToStaticType<
      OptionalProperty<JsonSchema, 'json'> &
        OptionalProperty<QuerySchema, 'query'> &
        OptionalProperty<ParamSchema, 'param'> &
        OptionalProperty<HeaderSchema, 'header'> &
        OptionalProperty<FormSchema, 'form'> &
        OptionalProperty<CookieSchema, 'cookie'>
    >;
  }
>(
  openApiOptions: {
    json?: JsonSchema;
    query?: QuerySchema;
    form?: FormSchema;
    cookie?: CookieSchema;
    header?: HeaderSchema;
    param?: ParamSchema;
  } & OpenApiRouteDefinition & {
      responseSampling?: SampleResponseOptions;
    }
) {
  //We want to bundle the validation middleware

  const {
    json,
    query,
    form,
    cookie,
    header,
    param,
    responseSampling,
    ...rest
  } = openApiOptions;

  //Typescript types and typebox do not support propagating Lowercase helper for header values.
  //Hono automatically lowercases header values. It should be possible but the time effort currently isn't worth it. //Do a runtime check instead.

  if (header) {
    if (TypeGuard.IsObject(header)) {
      Object.keys(header.properties).forEach((key) => {
        if (key !== key.toLowerCase()) {
          throw new Error(
            `Header fields in Hono are always converted to lowercase. The open api header schema can not contain any capital letters`
          );
        }
      });
    } else {
      throw new Error(
        'Header validation schema should be of type Type.Object.'
      );
    }
  }

  const middlewareFunction: OpenApiMiddlewareFunction<E, P, V> = async (
    c,
    next
  ) => {
    const nextStub = async () => {};

    if (c.req.method === 'get' && json !== undefined) {
      console.error(
        'Json validation handler can not be defined for get routes!. Validation handler will be ignored.'
      );
    }

    //Run all validators so we get the full response message back if multiple validators fail
    const collectedErrors: Record<string, ValueError[]> = {};

    const performValidation = async (
      target: keyof ValidationTargets,
      schema?: TSchema
    ) => {
      if (schema !== undefined) {
        return validator(target, (data, c) => {
          const dataWithDefault = Value.Default(schema, data);
          const casted = Value.Convert(schema, dataWithDefault);

          if (Value.Check(schema, casted)) {
            return casted;
          }
          let errors = [...Value.Errors(schema, casted)];

          //Modify error object
          //@ts-expect-error we modify some properties like type as this should not be printed to the user.
          errors = errors.map((e) => {
            return {
              ...e,
              //Get rid of leading slash
              path: e.path, //e.path.substring(1),

              // type: undefined,
              type: ValueErrorType[e.type],
              schema: {
                ...e.schema,
                open_api_ref: undefined,
              },
            };
          });

          collectedErrors[target] = errors;
        })(c as any, nextStub);
      }
    };

    let validationResponse;

    if (c.req.method !== 'get') {
      validationResponse = await performValidation('json', openApiOptions.json);
    }

    if (validationResponse instanceof Response) {
      return validationResponse;
    }

    validationResponse = await performValidation('query', openApiOptions.query);
    if (validationResponse instanceof Response) {
      return validationResponse;
    }

    validationResponse = await performValidation('param', openApiOptions.param);
    if (validationResponse instanceof Response) {
      return validationResponse;
    }

    validationResponse = await performValidation(
      'header',
      openApiOptions.header
    );
    if (validationResponse instanceof Response) {
      return validationResponse;
    }

    validationResponse = await performValidation('form', openApiOptions.form);
    if (validationResponse instanceof Response) {
      return validationResponse;
    }

    validationResponse = await performValidation(
      'cookie',
      openApiOptions.cookie
    );
    if (validationResponse instanceof Response) {
      return validationResponse;
    }

    if (Object.keys(collectedErrors).length > 0) {
      const validationCallback =
        middlewareFunction.validationFunctionOption?.validationCallback;
      if (validationCallback) {
        const response = await validationCallback(c, collectedErrors);
        if (response instanceof Response) {
          return response;
        }
      }

      //Default response
      return c.json(
        {
          success: false,
          description:
            'Bad request. One or more fields did not pass validation',
          errors: collectedErrors,
        },
        middlewareFunction.validationFunctionOption?.errorCode ?? 400
      );
    }

    await next();

    //TODO here we could implement response validation if we really wanted to
  };

  middlewareFunction['openApiData'] = { ...rest };
  middlewareFunction['inferred'] = { json, query, form, cookie, header, param };
  middlewareFunction['responseSampling'] = responseSampling;

  return middlewareFunction;
}
