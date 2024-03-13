import '@sinclair/typebox';

declare module '@sinclair/typebox' {
  interface TSchema {
    /** Reference used inside the openapi spec to reuse the identical schema*/
    open_api_ref?: {
      body?: string;
      path?: string;
      query?: string;
      header?: string;
      cookie?: string;
    };
  }
}
