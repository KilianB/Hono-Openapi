import { TSchema, Type } from '@sinclair/typebox/type';

export const jsonStringToTypeboxSchema = (jsonAsString: string): TSchema => {
  return JSON.parse(jsonAsString, (_outsideKey, value) => {
    if (value === null) {
      return Type.Null();
    }

    if (typeof value === 'boolean') {
      return Type.Boolean({
        example: value,
      });
    }

    if (typeof value === 'number') {
      return Type.Number({
        example: value,
      });
    }

    if (typeof value === 'string') {
      return Type.String({
        example: value,
      });
    }

    if (Array.isArray(value)) {
      let arrItemType: string | null = null;
      const haveSameType = value.every((v) => {
        const vType = v as TSchema;

        if (arrItemType === null) {
          arrItemType = vType.type;
        } else {
          if (arrItemType !== vType.type) {
            return false;
          }
        }
        return true;
      });

      // return Type.Array(
      //   Type.String({
      //     examples: 'inside array',
      //   })
      // );

      if (haveSameType) {
        return Type.Array(value[0]);
      } else {
        return Type.Tuple([...value], {
          //TODO
          minItems: 0,
          maxItems: 1000,
        });
      }
    }

    if (typeof value === 'object') {
      // const key = Object.keys(value)[0];

      return Type.Object(
        {
          ...value,
        },
        {
          additionalProperties: false,
        }
      );
    }

    return value;
  });
};

export const textStringToTypeboxSchema = (text: string): TSchema => {
  return Type.String({
    example: text,
  });
};
