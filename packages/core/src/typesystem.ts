import {
  ArrayOptions,
  Kind,
  ObjectOptions,
  SchemaOptions,
  Static,
  TArray,
  TIntersect,
  TNot,
  TObject,
  TProperties,
  TSchema,
  TUnion,
  TUnknown,
  TUnsafe,
  Type,
  TypeGuard,
  TypeRegistry,
  Union,
} from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
/**
 * Type guards for determining the type of schema we are currently working on.
 * E.g. an anyOf schema object, oneOf, enum, const, etc..
 */
import {
  DefaultErrorFunction,
  SetErrorFunction,
} from '@sinclair/typebox/errors';
import {
  JSONSchema7,
  JSONSchema7Definition,
  JSONSchema7Type,
  JSONSchema7TypeName,
} from 'json-schema';
import { isDeepEqual } from './utils';

// Extend the default typebox system with custom generated types

/**
 * OpenApi type supporting enums
 * @param values
 * @returns
 */
export const TEnum = <T extends number[] | string[]>(
  values: [...T],
  options?: SchemaOptions
) =>
  Type.Unsafe<T[number]>({
    type: typeof values[0],
    [Kind]: 'TEnum',
    enum: values,
    ...options,
  });

TypeRegistry.Set('TEnum', (schema: TUnsafe<unknown>, value: unknown) => {
  if ('enum' in schema && Array.isArray(schema['enum'])) {
    return schema['enum'].includes(value);
  } else {
    throw new Error("TEnum isn't correctly formatted. Expected enum property");
  }
});

SetErrorFunction((e) => {
  if (e.schema[Kind] === 'TEnum') {
    return `Provided value '${
      e.value
    }' does not match permitted values [${e.schema.enum.join(',')}]`;
  }
  return DefaultErrorFunction(e);
});

//Format registry as found in open api docs

TypeRegistry.Set(
  'ExtendedOneOf',
  (schema: any, value) =>
    1 ===
    schema.oneOf.reduce(
      (acc: number, schema: any) => acc + (Value.Check(schema, value) ? 1 : 0),
      0
    )
);
const OneOf = <T extends TSchema[]>(
  oneOf: [...T],
  options: SchemaOptions = {}
) =>
  Type.Unsafe<Static<TUnion<T>>>({
    ...options,
    [Kind]: 'ExtendedOneOf',
    oneOf,
  });

/**
 * Takes the root schema and recursively jsonSchemaToTypeboxs the corresponding types
 * for it. Returns the matching typebox string representing the schema.
 *
 * @throws Error if an unexpected schema (one with no matching parser) was given
 */
export const jsonSchemaToTypebox = (schema: JSONSchema7Definition): TSchema => {
  // TODO: boolean schema support..?
  if (isBoolean(schema)) {
    //TODO optional fields for boolean
    return Type.Boolean();
  } else if (isObjectSchema(schema)) {
    return parseObject(schema);
  } else if (isEnumSchema(schema)) {
    return parseEnum(schema);
  } else if (isAnyOfSchema(schema)) {
    return parseAnyOf(schema);
  } else if (isAllOfSchema(schema)) {
    return parseAllOf(schema);
  } else if (isOneOfSchema(schema)) {
    return parseOneOf(schema);
  } else if (isNotSchema(schema)) {
    return parseNot(schema);
  } else if (isArraySchema(schema)) {
    return parseArray(schema);
  } else if (isSchemaWithMultipleTypes(schema)) {
    return parseWithMultipleTypes(schema);
  } else if (isConstSchema(schema)) {
    return parseConst(schema);
  } else if (schema.type !== undefined && !Array.isArray(schema.type)) {
    return parsePrimitive(schema.type, schema);
  }
  throw new Error(
    `Unsupported schema. Did not match any type of the parsers. Schema was: ${JSON.stringify(
      schema
    )}`
  );
};

// const addOptionalModifier = (
//   string: string,
//   propertyName: string,
//   requiredProperties: JSONSchema7['required']
// ) => {
//   return requiredProperties?.includes(propertyName)
//     ? string
//     : `Type.Optional(${string})`;
// };

/**
 * Fixes issue for JSON schemas with attributes like (without the quotes) "@test",
 * "123", or "some with spaces". see: https://github.com/xddq/schema2typebox/pull/36
 * Returns the property name wrapped in quotes whenever quotes are required.
 */
export const quotePropertyNameWhenRequired = (propertyName: string) => {
  const quotingIsNotRequired = /^[A-Za-z_$].*/.test(propertyName);
  return quotingIsNotRequired ? propertyName : `"${propertyName}"`;
};

export const parseObject = (schema: ObjectSchema): TObject | TUnknown => {
  const schemaOptions = parseSchemaOptions(schema);
  const properties = schema.properties;
  const requiredProperties = schema.required;
  if (properties === undefined) {
    return Type.Unknown();
  }

  const objectProperties: TProperties = {};

  const attributes = Object.entries(properties);
  attributes.forEach(([propertyName, schema]) => {
    if (requiredProperties?.includes(propertyName)) {
      objectProperties[propertyName] = jsonSchemaToTypebox(schema);
    } else {
      objectProperties[propertyName] = Type.Optional(
        jsonSchemaToTypebox(schema)
      );
    }
  });

  return schemaOptions === undefined
    ? Type.Object(objectProperties, { additionalProperties: false })
    : Type.Object(objectProperties, schemaOptions as ObjectOptions);
};

export const parseEnum = (schema: EnumSchema): Union<any> => {
  const schemaOptions = parseSchemaOptions(schema);
  const primitiveTypes = schema.enum.map((schema) => {
    return parseType(schema);
  });

  return schemaOptions === undefined
    ? Type.Union(primitiveTypes)
    : Type.Union(primitiveTypes, schemaOptions);
};

export const parseConst = (schema: ConstSchema): TSchema => {
  const schemaOptions = parseSchemaOptions(schema);
  if (Array.isArray(schema.const)) {
    const childSchema = schema.const.map((schema) => parseType(schema));

    return schemaOptions === undefined
      ? Type.Union(childSchema)
      : Type.Union(childSchema, schemaOptions);
  }
  // TODO: case where const is object..?
  if (typeof schema.const === 'object') {
    // return Type.Todo(const with object);
    throw new Error('Const object not yet supported');
  }
  if (typeof schema.const === 'string') {
    return schemaOptions === undefined
      ? Type.Literal(schema.const)
      : Type.Literal(schema.const, schemaOptions);
  }
  return schemaOptions === undefined
    ? Type.Literal(schema.const)
    : Type.Literal(schema.const, schemaOptions);
};

export const parseType = (type: JSONSchema7Type): TSchema => {
  if (isString(type)) {
    return Type.Literal(type);
  } else if (isNullType(type)) {
    return Type.Null();
  } else if (isNumber(type) || isBoolean(type)) {
    return Type.Literal(type);
  } else if (Array.isArray(type)) {
    return Type.Array(parseType(type[0]));
  } else {
    const childSchema = Object.entries(type).reduce<Record<string, TSchema>>(
      (acc, [key, value]) => {
        acc[key] = parseType(value);
        return acc;
      },
      {}
    );
    return Type.Object(childSchema);
  }
};

export const parseAnyOf = (schema: AnyOfSchema): TSchema => {
  const schemaOptions = parseSchemaOptions(schema);
  const childSchemas = schema.anyOf.map((schema) => {
    return jsonSchemaToTypebox(schema);
  });
  return schemaOptions === undefined
    ? Type.Union(childSchemas)
    : Type.Union(childSchemas, schemaOptions);
};

export const parseAllOf = (schema: AllOfSchema): TIntersect<TSchema[]> => {
  const schemaOptions = parseSchemaOptions(schema);
  const childSchema = schema.allOf.map((schema) => jsonSchemaToTypebox(schema));
  return schemaOptions === undefined
    ? Type.Intersect(childSchema)
    : Type.Intersect(childSchema, schemaOptions);
};

export const parseOneOf = (schema: OneOfSchema): TUnsafe<unknown> => {
  const schemaOptions = parseSchemaOptions(schema);
  const childSchema = schema.oneOf.map((schema) => jsonSchemaToTypebox(schema));
  return schemaOptions === undefined
    ? OneOf(childSchema)
    : OneOf(childSchema, schemaOptions);
};

export const parseNot = (schema: NotSchema): TNot<TSchema> => {
  const schemaOptions = parseSchemaOptions(schema);
  const childSchema = jsonSchemaToTypebox(schema.not);
  return schemaOptions === undefined
    ? Type.Not(childSchema)
    : Type.Not(childSchema, schemaOptions);
};

export const parseArray = (schema: ArraySchema): TArray => {
  const schemaOptions = parseSchemaOptions(schema);
  if (Array.isArray(schema.items)) {
    const childSchema = schema.items.map((schema) =>
      jsonSchemaToTypebox(schema)
    );

    //   /** The minimum number of items in this array */
    //   minItems?: number;
    //   /** The maximum number of items in this array */
    //   maxItems?: number;
    //   /** Should this schema contain unique items */
    //   uniqueItems?: boolean;
    //   /** A schema for which some elements should match */
    //   contains?: TSchema;
    //   /** A minimum number of contains schema matches */
    //   minContains?: number;
    //   /** A maximum number of contains schema matches */
    //   maxContains?: number;

    return schemaOptions === undefined
      ? Type.Array(Type.Union(childSchema))
      : Type.Array(Type.Union(childSchema), schemaOptions as ArrayOptions);
  }

  return schemaOptions === undefined
    ? Type.Array(jsonSchemaToTypebox(schema.items))
    : Type.Array(
        jsonSchemaToTypebox(schema.items),
        schemaOptions as ArrayOptions
      );
};

export const parseWithMultipleTypes = (
  schema: MultipleTypesSchema
): TUnion<TSchema[]> => {
  const children = schema.type.map((typeName) => {
    return parsePrimitive(typeName);
  });
  return Type.Union(children);
};

export const parsePrimitive = (
  type: Omit<JSONSchema7TypeName, 'array' | 'object'>,
  schema: SchemaOptions = {}
): TSchema => {
  const schemaOptions = parseSchemaOptions(schema);
  if (type === 'number' || type === 'integer') {
    return schemaOptions === undefined
      ? Type.Number()
      : Type.Number(schemaOptions);
  } else if (type === 'string') {
    return schemaOptions === undefined
      ? Type.String()
      : Type.String(schemaOptions);
  } else if (type === 'boolean') {
    return schemaOptions === undefined
      ? Type.Boolean()
      : Type.Boolean(schemaOptions);
  } else if (type === 'null') {
    return schemaOptions === undefined ? Type.Null() : Type.Null(schemaOptions);
  }
  throw new Error(`Should never happen..? parseType got type: ${type}`);
};

const parseSchemaOptions = (schema: JSONSchema7): JSONSchema7 | undefined => {
  const properties = Object.entries(schema).filter(([key, _value]) => {
    return (
      // NOTE: To be fair, not sure if we should filter out the title. If this
      // makes problems one day, think about not filtering it.
      key !== 'title' &&
      key !== 'type' &&
      key !== 'items' &&
      key !== 'allOf' &&
      key !== 'anyOf' &&
      key !== 'oneOf' &&
      key !== 'not' &&
      key !== 'properties' &&
      key !== 'required' &&
      key !== 'const' &&
      key !== 'enum'
    );
  });
  if (properties.length === 0) {
    return undefined;
  }
  const result = properties.reduce<Record<string, unknown>>(
    (acc, [key, value]) => {
      acc[key] = value;
      return acc;
    },
    {}
  );

  return result;
};

const isString = (obj: any): obj is string => {
  return typeof obj === 'string';
};

const isNumber = (obj: any): obj is number => {
  return typeof obj === 'number';
};

const isBoolean = (obj: any): obj is boolean => {
  return typeof obj === 'boolean';
};

export type ObjectSchema = JSONSchema7 & { type: 'object' };
export const isObjectSchema = (schema: JSONSchema7): schema is ObjectSchema => {
  return schema['type'] !== undefined && schema['type'] === 'object';
};

export type EnumSchema = JSONSchema7 & { enum: JSONSchema7Type[] };
export const isEnumSchema = (schema: JSONSchema7): schema is EnumSchema => {
  return schema['enum'] !== undefined;
};

export type AnyOfSchema = JSONSchema7 & { anyOf: JSONSchema7Definition[] };
export const isAnyOfSchema = (schema: JSONSchema7): schema is AnyOfSchema => {
  return schema['anyOf'] !== undefined;
};

export type AllOfSchema = JSONSchema7 & { allOf: JSONSchema7Definition[] };
export const isAllOfSchema = (schema: JSONSchema7): schema is AllOfSchema => {
  return schema['allOf'] !== undefined;
};

export type OneOfSchema = JSONSchema7 & { oneOf: JSONSchema7Definition[] };
export const isOneOfSchema = (schema: JSONSchema7): schema is OneOfSchema => {
  return schema['oneOf'] !== undefined;
};

export type NotSchema = JSONSchema7 & { not: JSONSchema7Definition };
export const isNotSchema = (schema: JSONSchema7): schema is NotSchema => {
  return schema['not'] !== undefined;
};

export type ArraySchema = JSONSchema7 & {
  type: 'array';
  items: JSONSchema7Definition | JSONSchema7Definition[];
};
export const isArraySchema = (schema: JSONSchema7): schema is ArraySchema => {
  return schema.type === 'array' && schema.items !== undefined;
};

export type ConstSchema = JSONSchema7 & { const: JSONSchema7Type };
export const isConstSchema = (schema: JSONSchema7): schema is ConstSchema => {
  return schema.const !== undefined;
};

export type MultipleTypesSchema = JSONSchema7 & { type: JSONSchema7TypeName[] };
export const isSchemaWithMultipleTypes = (
  schema: JSONSchema7
): schema is MultipleTypesSchema => {
  return Array.isArray(schema.type);
};

export const isStringType = (type: JSONSchema7Type): type is string => {
  return typeof type === 'string';
};

export const isNullType = (type: JSONSchema7Type): type is null => {
  return type === null;
};

/**
 * Flatten a 2 typebox objects into a single one with all overlapping objects being required,
 *
 * @param schemas
 * @param options
 * @returns
 */
export function mergeObjectSchemas<T extends TSchema, T1 extends TSchema>(
  schemas: [T, T1],
  options?: SchemaOptions
): TObject {
  //TObject<Cast<UnionToIntersection<T['properties']>, TProperties>>
  const x = schemas[0];
  const y = schemas[1];

  // if (x.type === 'object' && y.type === 'object') {
  const existsInBoth: Set<string> = new Set();

  //Flatten required options
  x.required?.forEach((x: string) => {
    const presentInBoth = y.required?.includes(x);
    if (presentInBoth) {
      existsInBoth.add(x);
    }
  });

  //TODO we need to do this merging deeply?

  const merged = Type.Composite([x, y], options);
  merged.required = Array.from(existsInBoth);
  return merged;
}

/**
 * Flatten a typebox schema and remove any intersection which only contains schemas where the example key differs.
 * @param schema
 * @returns
 */
export const flattenIntersections = (schema: TSchema): TSchema => {
  if (TypeGuard.IsIntersect(schema)) {
    //Check if there are duplicates that can be flattened.

    //Primitives
    const deduplicatedSchemas: TSchema[] = [];

    schema.allOf.forEach((v) => {
      //Primitive work directly. For everything else try to flatten it

      //Non primitives

      let flattenedType: TSchema;

      if (TypeGuard.IsArray(v) || TypeGuard.IsObject(v)) {
        flattenedType = flattenIntersections(v);
      } else if (
        //Primitives
        TypeGuard.IsString(v) ||
        TypeGuard.IsBoolean(v) ||
        TypeGuard.IsNumber(v) ||
        TypeGuard.IsNull(v)
      ) {
        flattenedType = v;
      } else {
        throw new Error(
          `Type ${v.type} Not yet supported by flattening operation`
        );
      }

      //Consolidate
      const similarExists = deduplicatedSchemas.some((s) =>
        isDeepEqual(s, v, ['example'])
      );

      //Should we merge examples?

      if (!similarExists) {
        deduplicatedSchemas.push(v);
      }
    });

    if (deduplicatedSchemas.length > 1) {
      return Type.Intersect(deduplicatedSchemas, schema);
    } else {
      return deduplicatedSchemas[0];
    }
  } else if (TypeGuard.IsArray(schema)) {
    const children = flattenIntersections(schema.items);
    return Type.Array(children);
  } else if (TypeGuard.IsObject(schema)) {
    if (schema.properties !== undefined) {
      const flattened = Object.entries(schema.properties).reduce<
        Record<string, TSchema>
      >((acc, [key, propSchema]) => {
        const needsOptional =
          !schema.required?.includes(key) && !TypeGuard.IsOptional(propSchema);
        const flattenedSchema = flattenIntersections(propSchema as TSchema);

        acc[key] = needsOptional
          ? Type.Optional(flattenedSchema)
          : flattenedSchema;
        return acc;
      }, {});

      return Type.Object(flattened, buildObjectOptions(schema));
    } else {
      return Type.Object({});
    }
  }

  return schema;
};

const buildObjectOptions = (schema: TObject): ObjectOptions | undefined => {
  const options: ObjectOptions = {};

  //Setting it to undefined will result in them showing up as undefined. They actually need to be missing.
  if (schema.$id) {
    options['$id'] = schema.$id;
  }
  if (schema.additionalProperties) {
    options['additionalProperties'] = schema.additionalProperties;
  }
  if (schema.default) {
    options['default'] = schema.default;
  }
  if (schema.description) {
    options['description'] = schema.description;
  }
  if (schema.examples) {
    options['examples'] = schema.examples;
  }
  if (schema.minProperties) {
    options['minProperties'] = schema.minProperties;
  }
  if (schema.maxProperties) {
    options['maxProperties'] = schema.maxProperties;
  }
  if (schema.title) {
    options['title'] = schema.title;
  }

  return Object.keys(options).length > 0 ? options : undefined;
};
