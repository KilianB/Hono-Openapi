import type { OpenApiRenderer } from '@hono-openapi/shared';

import type { SwaggerUIOptions } from 'swagger-ui';

interface SwaggerOptions extends SwaggerUIOptions {
  pageTitle?: string;
  theme?: 'dark' | 'default' | string;
  version?: string;
}

export const swaggerUi = (
  swaggerOptions: SwaggerOptions = {}
): OpenApiRenderer => {
  const { pageTitle, theme, version, ...nativeSwaggerUiOptions } =
    swaggerOptions;

  return {
    serve({ context, swaggerJsonUrl }) {
      let augmentedSwaggerOptions = { ...swaggerOptions };

      if (swaggerOptions.url === undefined) {
        augmentedSwaggerOptions.url = swaggerJsonUrl;
      }

      if (
        swaggerOptions.dom_id === undefined &&
        swaggerOptions.domNode === undefined
      ) {
        console.log('Dom id emptry');
        augmentedSwaggerOptions.dom_id = '#content';
      } else {
        console.log('Dom id not empty');
      }

      const cdnUrl = `https://unpkg.com/swagger-ui-dist${
        swaggerOptions.version ? `@${swaggerOptions.version}` : ''
      }`;

      const html = `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>${swaggerOptions?.pageTitle ?? 'API Reference'}</title>
            <style>
               ${(swaggerOptions.theme && style[swaggerOptions.theme]) ?? ''}
            </style>
            <link rel="stylesheet" href="${cdnUrl}/swagger-ui.css" />

        </head>
        <body>
            <div id="swagger-ui"></div>
            <script src="${cdnUrl}/swagger-ui-bundle.js" crossorigin></script>
            <script>
window.onload = () => {
    console.log("Window on load");
    window.ui = SwaggerUIBundle(${JSON.stringify(augmentedSwaggerOptions)});
};
            </script>
            <div id='content' />
        </body>
        </html>`;

      return context.html(html);
    },
  };
};

const style: Record<string, string> = {
  dark: ` @media (prefers-color-scheme: dark) {
        body {
            background-color: #222;
            color: #faf9a;
        }
        .swagger-ui {
            filter: invert(92%) hue-rotate(180deg);
        }

        .swagger-ui .microlight {
            filter: invert(100%) hue-rotate(180deg);
        }
    }`,
  default: ``,
};
