import { describe, expect, it } from 'bun:test';
import { deepCloneAndMerge } from '../src/utils';

describe('Deep merge', () => {
  it('merges objects', async () => {
    const o = { a: 1, b: 2, c: 3, d: undefined };
    const o1 = { b: 'test', d: 5, c: undefined, e: 6 };

    const result = deepCloneAndMerge(o, o1);

    expect(result.a).toEqual(1);
    expect(result.b).toEqual('test');
    expect(result.c).toEqual(3);
    expect(result.d).toEqual(5);
    expect(result.e).toEqual(6);
  });

  it('merges objects deep', async () => {
    const o = {
      a: 1,
      b: {
        c: 3,
        d: 4,
        e: 5,
      },
    };
    const o1 = {
      b: {
        c: 6,
        e: 8,
      },
    };

    const result = deepCloneAndMerge(o, o1);

    expect(result.a).toEqual(1);
    expect(result.b.c).toEqual(6);
    expect(result.b.d).toEqual(4);
    expect(result.b.e).toEqual(8);
  });

  it('merges arrays', async () => {
    const o = {
      a: 1,
      b: [1, 2, 3],
    };
    const o1 = {
      b: [3, 4, 5],
    };

    const result = deepCloneAndMerge(o, o1);

    expect(result.b).toBeArrayOfSize(6);
  });
});
