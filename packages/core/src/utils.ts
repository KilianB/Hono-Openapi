export const mergePath = (...paths: string[]): string => {
  let p: string = '';
  let endsWithSlash = false;

  for (let path of paths) {
    /* ['/hey/','/say'] => ['/hey', '/say'] */
    if (p[p.length - 1] === '/') {
      p = p.slice(0, -1);
      endsWithSlash = true;
    }

    /* ['/hey','say'] => ['/hey', '/say'] */
    if (path[0] !== '/') {
      path = `/${path}`;
    }

    /* ['/hey/', '/'] => `/hey/` */
    if (path === '/' && endsWithSlash) {
      p = `${p}/`;
    } else if (path !== '/') {
      p = `${p}${path}`;
    }

    /* ['/', '/'] => `/` */
    if (path === '/' && p === '') {
      p = '/';
    }
  }

  return p;
};

/**
 * Deep compare to objects for equality with the ability to skip specified key props.
 * The order of the keys inside objects does not matter for equality comparison
 *
 * @param obj1 first object
 * @param obj2  second object
 * @param propsToIgnore string array or nothing of properties to ignore
 * @returns true if the object are equal except fields in the entire hierarchy that match the propsToIgnore
 */
export const isDeepEqual = (
  obj1: unknown,
  obj2: unknown,
  propsToIgnore: string[] = []
): boolean => {
  //Primitive and reference implementation
  if (obj1 === obj2) {
    return true;
  }

  if (
    obj1 == null ||
    obj2 == null ||
    (!isObjectLike(obj1) && !isObjectLike(obj2))
  ) {
    return obj1 !== obj1 && obj2 !== obj2;
  }

  const isArr1 = Array.isArray(obj1);
  const isArr2 = Array.isArray(obj2);

  //Now go and iterate over all keys.
  if (isArr1 !== isArr2) {
    return false;
  }

  if (isArr1 && isArr2) {
    if (obj1.length !== obj2.length) {
      return false;
    } else {
      return obj1.every((_, i) => {
        return isDeepEqual(obj1[i], obj2[i], propsToIgnore);
      });
    }
  }

  //Call each element pairwise

  const keys1 = Object.keys(obj1).filter((k) => !propsToIgnore.includes(k));
  const keys2 = Object.keys(obj2).filter((k) => !propsToIgnore.includes(k));

  if (keys1.length !== keys2.length) {
    return false;
  }

  //Check if the names match
  const hasEveryKey = keys1.every((k) => keys2.includes(k));
  if (!hasEveryKey) {
    return false;
  }
  return keys1.every((key) =>
    isDeepEqual(
      obj1[key as keyof typeof obj1],
      obj2[key as keyof typeof obj2],
      propsToIgnore
    )
  );
};

const isObjectLike = (value: unknown) => {
  return typeof value === 'object' && value !== null;
};

/**
 * Deeply merge 2 objects recursively. If parameters are present in both
 * objects the second object takes precedence if the value is not undefined.
 *
 * Arrays are concatenated and are the main difference between merging with libraries like lodash.
 *
 * Does not handle circular dependencies
 */
export const deepCloneAndMerge = <T1, T2>(
  o: T1,
  o1: T2,
  path?: string
): any => {
  if (typeof o === 'object' && typeof o1 === 'object') {
    //Handle array

    let r = handleArrayMerge(o, o1, path);
    if (r !== undefined) {
      return r;
    }

    r = handleArrayMerge(o1, o, path);
    if (r !== undefined) {
      return r;
    }

    if (o === null) {
      if (o1 === null) {
        return null;
      } else {
        //Deep copy
        return { ...o1 };
      }
    } else if (o1 === null) {
      //Deep copy
      return { ...o };
    } else {
      //merge those
      const newObj: Record<string, unknown> = {};

      const keys = [...Object.keys(o), ...Object.keys(o1)];
      keys.forEach((key) => {
        //@ts-expect-error we are not sure about the values. Implicit any is fine.
        newObj[key] = deepCloneAndMerge(o[key], o1[key], `${path}/${key}`);
      });
      return newObj;
    }
  }

  //TODO handle functions? How can they be deeply cloned?

  //Second one takes precedence;
  if (o1 !== undefined) {
    return o1;
  }

  return o;
};

const handleArrayMerge = (o: unknown, o1: unknown, path?: string) => {
  if (Array.isArray(o)) {
    if (Array.isArray(o1)) {
      //Just concatenate
      return [...o, ...o1];
    } else {
      if (o1 === undefined || o1 === null) {
        return [...o];
      } else {
        throw new Error(`Can not deep merge array and object. path: ${path}`);
      }
    }
  }
};

/**
 * Ensure that a value is an array, except when it is undefined.
 * If the value already is an array this is a NOP, else it will be wrapped
 * 
 * @param potentialArray value that will be ensured to be an array 
 * @returns an array with the original value or undefined
 */
export const arrayify = <T>(potentialArray: T | T[] | undefined) : T[] | undefined => {

  if(Array.isArray(potentialArray) || potentialArray === undefined){
    //@ts-expect-error typescript isn't smart enough to infer here
    return potentialArray;
  }else{
    return [potentialArray];
  }

}