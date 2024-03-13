import type { Context } from 'hono';
import { HandlerResponse } from 'hono/types';

//Interfaces are duplicated from core package to avoid circular dependencies

export interface ProviderServeOptions {
  /** Path to the openapi.json spec file */
  swaggerJsonUrl: string;

  /** Request context */
  context: Context;

  renameModelCallback: (
    oldName: string,
    newName: string,
    headingId: string
  ) => void;
}

/**
 * OpenApiProviders are plugins that get called when the documentation page is requested.
 * This can be used to adjust the design of the created documentation or decide how the generated
 * spec file will be consumed.
 */
export interface OpenApiRenderer {
  /**
   * Callback that is responsible to return a website or other option to consume the generated openapi spec.
   * The return of this method is directly returned from the hono route handler and acts as a normal registered route endpoint.
   *
   * Most likely scenarios are returning html files that are embedding the spec files.
   *
   * @param options
   * @returns anything that can be served via hono.
   */
  serve: (options: ProviderServeOptions) => HandlerResponse<any>;
}
