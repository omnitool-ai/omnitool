/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type WorkerContext } from '../BaseComponent';

const CustomTypes = new Map<
  string,
  {
    out?: Function;
    in?: Function;
    load?: Function;
    setup?: Function;
    socket: { type: string };
    schema: { type: string; items?: { type: string } };
  }
>();

function isValidUrl(str: string): boolean {
  let url;

  try {
    url = new URL(str);
  } catch (e) {
    return false;
  }

  return url.protocol === 'http:' || url.protocol === 'https:';
}

const persistObject = async (ctx: WorkerContext, value: any, opts?: any) => {
  if (value.ticket && value.url && !value.data) {
    // If we don't have data, it means we are already persisted
    return await Promise.resolve(value);
  }
  opts ??= {};
  const finalOpts = { userId: ctx.userId, jobId: ctx.jobId, ...opts };
  return ctx.app.cdn.putTemp(value, finalOpts);
};

const persistObjects = async (ctx: WorkerContext, value: any, opts?: any) => {
  return await Promise.all(
    value.map(async (v: any) => {
      return await persistObject(ctx, v);
    })
  );
};

CustomTypes.set('cdnObjectArray', {
  socket: {
    type: 'cdnObjectArray'
  },
  schema: {
    type: 'array',
    items: {
      type: 'object'
    }
  },
  // #v-ifdef MERCS_INCLUDE_CLIENT_WORKERS

  in: async function (value: any, ctx: any) {
    if (value != null && typeof value === 'string' && value.length > 0) {
      const imgs = value.split('\n');
      value = imgs.filter((x) => x.length > 0 && isValidUrl(x)).map((x) => x.trim());
      await Promise.all(
        value.map(async (v: string) => {
          return await persistObject(ctx, v);
        })
      );
    }

    if (!Array.isArray(value)) {
      if (value != null) {
        return [value];
      }
      return [];
    }

    value = value.filter((x) => x != null);

    if (value.length === 0) {
      return null;
    }

    if (!value[0].url) {
      value = await Promise.all(
        value.map(async (v: any) => {
          return await persistObject(ctx, v);
        })
      );
    }
    return value;
  },
  out: async function (value: any, ctx: any) {
    if (!Array.isArray(value)) {
      value = [value];
    }

    let result;
    try {
      result = await persistObjects(ctx, value);
    } catch (e) {
      console.error(e);
      throw new Error('Putting to CDN failed');
    }
    return result;
  }
  // #v-endif
});

CustomTypes.set('imageArray', {
  socket: {
    type: 'imageArray'
  },
  schema: {
    type: 'array',
    items: {
      type: 'object'
    }
  },
  // #v-ifdef MERCS_INCLUDE_CLIENT_WORKERS

  in: async function (value: any, ctx: any) {
    if (value != null && typeof value === 'string' && value.length > 0) {
      const imgs = value.split('\n');
      value = imgs.filter((x) => x.length > 0 && isValidUrl(x)).map((x) => x.trim());
      await Promise.all(
        value.map(async (v: string) => {
          return await persistObject(ctx, v);
        })
      );
    }

    if (!Array.isArray(value)) {
      if (value != null) {
        return [value];
      }
      return [];
    }

    value = value.filter((x) => x != null);

    if (value.length === 0) {
      return null;
    }

    if (!value[0].url) {
      value = await Promise.all(
        value.map(async (v: any) => {
          return await persistObject(ctx, v);
        })
      );
    }
    return value;
  },
  out: async function (value: any, ctx: any) {
    if (!Array.isArray(value)) {
      value = [value];
    }

    let result;
    try {
      result = await persistObjects(ctx, value);
    } catch (e) {
      console.error(e);
      throw new Error('Putting to CDN failed');
    }
    return result;
  }
  // #v-endif
});

CustomTypes.set('documentArray', {
  socket: {
    type: 'documentArray'
  },
  schema: {
    type: 'array',
    items: {
      type: 'object'
    }
  },
  // #v-ifdef MERCS_INCLUDE_CLIENT_WORKERS

  in: async function (value: any, ctx: any) {
    if (value != null && typeof value === 'string' && value.length > 0) {
      const imgs = value.split('\n');
      value = imgs.filter((x) => x.length > 0 && isValidUrl(x)).map((x) => x.trim());
      await Promise.all(
        value.map(async (v: string) => {
          return await persistObject(ctx, v);
        })
      );
    }

    if (!Array.isArray(value)) {
      if (value != null) {
        return [value];
      }
      return [];
    }

    value = value.filter((x) => x != null);

    if (value.length === 0) {
      return null;
    }

    if (!value[0].url) {
      value = await Promise.all(
        value.map(async (v: any) => {
          return await persistObject(ctx, v);
        })
      );
    }
    return value;
  },
  out: async function (value: any, ctx: any) {
    if (!Array.isArray(value)) {
      value = [value];
    }

    let result;
    try {
      result = await persistObjects(ctx, value);
    } catch (e) {
      console.error(e);
      throw new Error('Putting to CDN failed');
    }
    return result;
  }
  // #v-endif
});

CustomTypes.set('audioArray', {
  socket: {
    type: 'audioArray'
  },
  schema: {
    type: 'array',
    items: {
      type: 'object'
    }
  },
  // #v-ifdef MERCS_INCLUDE_CLIENT_WORKERS

  in: async function (value: any, ctx: any) {
    if (value != null && typeof value === 'string' && value.length > 0) {
      const imgs = value.split('\n');
      value = imgs.filter((x) => x.length > 0 && isValidUrl(x)).map((x) => x.trim());
      await Promise.all(
        value.map(async (v: string) => {
          return await persistObject(ctx, v);
        })
      );
    }

    if (!Array.isArray(value)) {
      if (value != null) {
        return [value];
      }
      return [];
    }

    value = value.filter((x) => x != null);

    if (value.length === 0) {
      return null;
    }

    if (!value[0].url) {
      value = await Promise.all(
        value.map(async (v: any) => {
          return await persistObject(ctx, v);
        })
      );
    }
    return value;
  },
  out: async function (value: any, ctx: any) {
    if (!Array.isArray(value)) {
      value = [value];
    }

    let result;
    try {
      result = await persistObjects(ctx, value);
    } catch (e) {
      console.error(e);
      throw new Error('Putting to CDN failed');
    }
    return result;
  }
  // #v-endif
});

CustomTypes.set('objectArray', {
  socket: {
    type: 'objectArray'
  },
  schema: {
    type: 'array',
    items: {
      type: 'object'
    }
  },
  // #v-ifdef MERCS_INCLUDE_CLIENT_WORKERS

  in: async function (value: any, ctx: any) {
    if (!Array.isArray(value)) {
      if (value != null) {
        return [value];
      }
      return [];
    }
    return value;
  },
  out: async function (value: any, ctx: any) {
    if (!Array.isArray(value)) {
      value = [value];
    }
    return value;
  }
  // #v-endif
});

CustomTypes.set('image', {
  socket: {
    type: 'image'
  },
  schema: {
    type: 'object'
  },
  // #v-ifdef MERCS_INCLUDE_CLIENT_WORKERS

  in: async function (value: any, ctx: any) {
    if (Array.isArray(value) && value.length > 0) {
      value = value[0];
    }

    if (value != null && typeof value === 'string' && value.length > 0 && isValidUrl(value)) {
      value = await persistObject(ctx, value.trim());
    }

    if (!value) {
      return null;
    }

    if (value && !value.url) {
      value = await persistObject(ctx, value);
    }

    return value;
  },

  out: async function (value: any, ctx: any) {
    if (Array.isArray(value) && value.length > 0) {
      value = value[0];
    }
    let result;
    try {
      result = await persistObject(ctx, value);
    } catch (e) {
      console.error(e);
      throw new Error('Putting to CDN failed');
    }
    return result;
  }
  // #v-endif
});

CustomTypes.set('cdnObject', {
  socket: {
    type: 'cdnObject'
  },
  schema: {
    type: 'object'
  },
  // #v-ifdef MERCS_INCLUDE_CLIENT_WORKERS

  in: async function (value: any, ctx: any) {
    if (Array.isArray(value) && value.length > 0) {
      value = value[0];
    }

    if (value != null && typeof value === 'string' && value.length > 0 && isValidUrl(value)) {
      value = await persistObject(ctx, value.trim());
    }

    if (!value) {
      return null;
    }

    if (value && !value.url) {
      value = await persistObject(ctx, value);
    }

    return value;
  },

  out: async function (value: any, ctx: any) {
    if (Array.isArray(value) && value.length > 0) {
      value = value[0];
    }
    let result;
    try {
      result = await persistObject(ctx, value);
    } catch (e) {
      console.error(e);
      throw new Error('Putting to CDN failed');
    }
    return result;
  }
  // #v-endif
});

CustomTypes.set('document', {
  socket: {
    type: 'document'
  },
  schema: {
    type: 'object'
  },
  // #v-ifdef MERCS_INCLUDE_CLIENT_WORKERS

  in: async function (value: any, ctx: any) {
    if (Array.isArray(value) && value.length > 0) {
      value = value[0];
    }

    if (value != null && typeof value === 'string' && value.length > 0 && isValidUrl(value)) {
      value = await persistObject(ctx, value.trim());
    }

    if (!value) {
      return null;
    }

    if (value && !value.url) {
      value = await persistObject(ctx, value);
    }

    return value;
  },

  out: async function (value: any, ctx: any) {
    if (Array.isArray(value) && value.length > 0) {
      value = value[0];
    }
    let result;
    try {
      result = await persistObject(ctx, value);
    } catch (e) {
      console.error(e);
      throw new Error('Putting to CDN failed');
    }
    return result;
  }
  // #v-endif
});

CustomTypes.set('audio', {
  socket: {
    type: 'audio'
  },
  schema: {
    type: 'object'
  },
  // #v-ifdef MERCS_INCLUDE_CLIENT_WORKERS

  in: async function (value: any, ctx: any) {
    if (Array.isArray(value) && value.length > 0) {
      value = value[0];
    }

    if (value != null && typeof value === 'string' && value.length > 0 && isValidUrl(value)) {
      value = await persistObject(ctx, value.trim());
    }

    if (!value) {
      return null;
    }

    if (value && !value.url) {
      value = await persistObject(ctx, value);
    }

    return value;
  },

  out: async function (value: any, ctx: any) {
    if (Array.isArray(value) && value.length > 0) {
      value = value[0];
    }
    let result;
    try {
      result = await persistObject(ctx, value);
    } catch (e) {
      console.error(e);
      throw new Error('Putting to CDN failed');
    }
    return result;
  }
  // #v-endif
});

CustomTypes.set('text', {
  socket: {
    type: 'text'
  },
  schema: {
    type: 'string'
  },
  // #v-ifdef MERCS_INCLUDE_CLIENT_WORKERS

  in: function (value: any, ctx: any) {
    if (value != null && value !== '') {
      if (Array.isArray(value) && value.length > 0) {
        value = value.map((v) => {
          if (typeof v === 'object' && v.url) {
            return v.url;
          } else {
            return JSON.stringify(value);
          }
        });
        return value.join('\n');
      } else {
        if (typeof value === 'object' && value.url) {
          return value.url;
        }

        if (typeof value.toString === 'function') {
          return value.toString();
        }

        return `${value}`;
      }
    }
    console.warn('NULL value passed to text type');
    return null;
  },

  out: async function (value: any, ctx: any) {
    if (value != null) {
      if (typeof value !== 'string') {
        if (typeof value === 'number') {
          value = `${value}`;
        }

        if (typeof value === 'object' && value.url) {
          value = value.url;
        }
      }
    }

    return value;
  }

  // #v-endif
});

CustomTypes.set('imageB64', {
  socket: {
    type: 'imageB64'
  },
  schema: {
    type: 'string'
  },
  // #v-ifdef MERCS_INCLUDE_CLIENT_WORKERS

  in: async function (value: any, ctx: any) {
    if (Array.isArray(value) && value.length > 0) {
      value = value[0];
    }

    if (value == null) {
      return null;
    }

    if (typeof value === 'string' && value.length > 0) {
      const imgs = value.split('\n');
      if (imgs.length > 0) {
        if (imgs[0].startsWith('data:image')) {
          value = imgs[0];
        } else if (isValidUrl(imgs[0])) {
          value = (await persistObject(ctx, imgs[0])).asBase64();
        }
      }
    } else if (value.ticket) {
      return (await ctx.app.cdn.get(value.ticket, null, 'asBase64')).data;
    }
  }

  // #v-endif
});

CustomTypes.set('imageB64Array', {
  socket: {
    type: 'imageB64Array'
  },
  schema: {
    type: 'string'
  },
  // #v-ifdef MERCS_INCLUDE_CLIENT_WORKERS

  in: async function (value: any, ctx: any) {
    if (value == null) {
      return null;
    }

    if (typeof value === 'string') {
      let imgs = value.split('\n');
      imgs = imgs.filter((v) => {
        return v && v.length > 0 && (v.startsWith('data') || isValidUrl(v));
      });

      if (imgs.length === 0) {
        return null;
      }
      value = await Promise.all(
        imgs.map(async (v) => {
          if (v.startsWith('data:image')) {
            return v;
          } else if (isValidUrl(v)) {
            return (await persistObject(ctx, v)).asBase64();
          }
        })
      );
    } else {
      if (!Array.isArray(value)) {
        value = [value];
      }

      if (value[0]?.ticket) {
        return await Promise.all(
          // @ts-ignore
          value.map(async (v) => {
            return (await ctx.app.cdn.get(v.ticket, null, 'asBase64')).data;
          })
        );
      }
    }
    return value;
  }

  // #v-endif
});

CustomTypes.set('error', {
  socket: {
    type: 'error'
  },
  schema: {
    type: 'object'
  }
});

export default CustomTypes;
