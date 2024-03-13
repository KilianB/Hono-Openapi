import type {
  OpenApiRenderer,
  ProviderServeOptions,
} from '@hono-openapi/shared';
import type { ReferenceConfiguration } from '@scalar/api-reference';

import { html, raw } from 'hono/html';
import type { HandlerResponse } from 'hono/types';

export type ApiReferenceOptions = ReferenceConfiguration & {
  pageTitle?: string;
  cdnUrl?: string;
};

export const scalar = (scalarOptions: ApiReferenceOptions): OpenApiRenderer => {
  return {
    serve: function (serveOptions: ProviderServeOptions): HandlerResponse<any> {
      return serveOptions.context.html(`
            <!DOCTYPE html>
            <html>
            <head>
            <title>${scalarOptions?.pageTitle ?? 'API Reference'}</title>
            <meta charset="utf-8" />
            <meta
            name="viewport"
            content="width=device-width, initial-scale=1" />
            <style>
            body {
                margin: 0;
            }
            
            ${scalarOptions.theme ? null : customThemeCSS}
            </style>
          </head>
          <body>
          ${javascript(scalarOptions)}
          </body>
          </html>
          `);
    },
  };
};

/**
 * The custom theme CSS for the API Reference.
 */
export const customThemeCSS = `
:root {
  --theme-font: 'Inter', var(--system-fonts);
}

.light-mode {
  color-scheme: light;
  --theme-color-1: #2a2f45;
  --theme-color-2: #757575;
  --theme-color-3: #8e8e8e;
  --theme-color-disabled: #b4b1b1;
  --theme-color-ghost: #a7a7a7;
  --theme-color-accent: #0099ff;
  --theme-background-1: #fff;
  --theme-background-2: #f6f6f6;
  --theme-background-3: #e7e7e7;
  --theme-background-4: rgba(0, 0, 0, 0.06);
  --theme-background-accent: #8ab4f81f;

  --theme-border-color: rgba(0, 0, 0, 0.1);
  --theme-scrollbar-color: rgba(0, 0, 0, 0.18);
  --theme-scrollbar-color-active: rgba(0, 0, 0, 0.36);
  --theme-lifted-brightness: 1;
  --theme-backdrop-brightness: 1;

  --theme-shadow-1: 0 1px 3px 0 rgba(0, 0, 0, 0.11);
  --theme-shadow-2: rgba(0, 0, 0, 0.08) 0px 13px 20px 0px,
    rgba(0, 0, 0, 0.08) 0px 3px 8px 0px, #eeeeed 0px 0 0 1px;

  --theme-button-1: rgb(49 53 56);
  --theme-button-1-color: #fff;
  --theme-button-1-hover: rgb(28 31 33);

  --theme-color-green: #069061;
  --theme-color-red: #ef0006;
  --theme-color-yellow: #edbe20;
  --theme-color-blue: #0082d0;
  --theme-color-orange: #fb892c;
  --theme-color-purple: #5203d1;
}

.dark-mode {
  color-scheme: dark;
  --theme-color-1: rgba(255, 255, 245, .86);
  --theme-color-2: rgba(255, 255, 245, .6);
  --theme-color-3: rgba(255, 255, 245, .38);
  --theme-color-disabled: rgba(255, 255, 245, .25);
  --theme-color-ghost: rgba(255, 255, 245, .25);
  --theme-color-accent: #e36002;
  --theme-background-1: #1e1e20;
  --theme-background-2: #2a2a2a;
  --theme-background-3: #505053;
  --theme-background-4: rgba(255, 255, 255, 0.06);
  --theme-background-accent: #e360021f;

  --theme-border-color: rgba(255, 255, 255, 0.1);
  --theme-scrollbar-color: rgba(255, 255, 255, 0.24);
  --theme-scrollbar-color-active: rgba(255, 255, 255, 0.48);
  --theme-lifted-brightness: 1.45;
  --theme-backdrop-brightness: 0.5;

  --theme-shadow-1: 0 1px 3px 0 rgb(0, 0, 0, 0.1);
  --theme-shadow-2: rgba(15, 15, 15, 0.2) 0px 3px 6px,
    rgba(15, 15, 15, 0.4) 0px 9px 24px, 0 0 0 1px rgba(255, 255, 255, 0.1);

  --theme-button-1: #f6f6f6;
  --theme-button-1-color: #000;
  --theme-button-1-hover: #e7e7e7;

  --theme-color-green: #3dd68c;
  --theme-color-red: #f66f81;
  --theme-color-yellow: #f9b44e;
  --theme-color-blue: #5c73e7;
  --theme-color-orange: #ff8d4d;
  --theme-color-purple: #b191f9;
}
/* Sidebar */
.light-mode .t-doc__sidebar {
  --sidebar-background-1: var(--theme-background-1);
  --sidebar-item-hover-color: currentColor;
  --sidebar-item-hover-background: var(--theme-background-2);
  --sidebar-item-active-background: var(--theme-background-accent);
  --sidebar-border-color: var(--theme-border-color);
  --sidebar-color-1: var(--theme-color-1);
  --sidebar-color-2: var(--theme-color-2);
  --sidebar-color-active: var(--theme-color-accent);
  --sidebar-search-background: var(--theme-background-2);
  --sidebar-search-border-color: var(--sidebar-border-color);
  --sidebar-search--color: var(--theme-color-3);
}

.dark-mode .sidebar {
  --sidebar-background-1: #161618;
  --sidebar-item-hover-color: var(--theme-color-accent);
  --sidebar-item-hover-background: transparent;
  --sidebar-item-active-background: transparent;
  --sidebar-border-color: transparent;
  --sidebar-color-1: var(--theme-color-1);
  --sidebar-color-2: var(--theme-color-2);
  --sidebar-color-active: var(--theme-color-accent);
  --sidebar-search-background: #252529;
  --sidebar-search-border-color: transparent;
  --sidebar-search--color: var(--theme-color-3);
}
`;

/**
 * The HTML to load the @scalar/api-reference JavaScript package.
 */
export const javascript = (configuration: ApiReferenceOptions) => {
  return html`
    <script
      id="api-reference"
      type="application/json"
      data-configuration="${JSON.stringify(configuration)
        .split('"')
        .join('&quot;')}"
    >
      ${raw(
        configuration.spec?.content
          ? typeof configuration.spec?.content === 'function'
            ? JSON.stringify(configuration.spec?.content())
            : JSON.stringify(configuration.spec?.content)
          : ''
      )}
    </script>
    <script src="${configuration.cdnUrl ??
      'https://cdn.jsdelivr.net/npm/@scalar/api-reference'}"></script>
    <script>
      //Add the ability to rename models
      document.addEventListener('DOMContentLoaded', () => {
        const addAbilityToRenameModels = () => {
          console.log('Rename model function executed');

          const modelSection = Array.from(
            document
              .getElementById('models')
              .parentElement.getElementsByTagName('section')
          );

          const inputSearchElement = document.getElementById('renameInputText');

          modelSection.forEach((section) => {
            //Get the heading
            const heading = section.getElementsByClassName('label')[0];
            const headingTextNode = heading.childNodes[1];
            const oldText = headingTextNode.nodeValue;

            // const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            const icon = document.createElement('div');
            icon.innerHtml =
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 25"><defs><style>.cls-1{fill:#231f20}</style></defs><g id="pencil"><path class="cls-1" d="m21.84 5-4.31-3.62a1.17 1.17 0 0 0-.87-.27 1.15 1.15 0 0 0-.8.42L3.1 16.65a.54.54 0 0 0-.11.26l-.84 6.44a.5.5 0 0 0 .49.56h.15L9 22a.47.47 0 0 0 .24-.15L22 6.69A1.19 1.19 0 0 0 21.84 5zm-.62 1L8.56 21l-5.32 1.7.76-5.51 12.66-15a.21.21 0 0 1 .27 0l4.27 3.59a.19.19 0 0 1 .02.27z"/><path class="cls-1" d="M15 5.75a.51.51 0 0 0-.71.06.49.49 0 0 0 .06.7l3.05 2.61a.49.49 0 0 0 .32.12.52.52 0 0 0 .38-.17.51.51 0 0 0-.1-.71z"/></g></svg>';
            heading.appendChild(icon);

            //Add a new button to enable editing
            inputSearchElement.placeHolder = 'Rename ' + oldText;

            headingTextNode.nodeValue = '';
          });
        };

        const modelElem = document.getElementById('models');

        if (modelElem === null) {
          // Callback function to execute when the target element appears
          const callback = function (mutationsList, observer) {
            for (let mutation of mutationsList) {
              if (mutation.type === 'childList') {
                for (let node of mutation.addedNodes) {
                  console.log('node', node);
                  addAbilityToRenameModels();
                }
              }
            }
          };

          // Options for the observer (which mutations to observe)
          const config = { childList: true, subtree: true };

          // Create a new observer instance
          const observer = new MutationObserver(callback);

          // Start observing the target element
          observer.observe(document.body, config);
        } else {
          addAbilityToRenameModels();
        }
      });
    </script>

    <div
      id="rename_modal"
      style="position:absolute; z-index:100; width:100%; height:100%; left:0; top:0; background-color:#8080805e; display:none"
    >
      <div
        style="position:absolute; left:50%; top:50%; min-width: 100px; min-height: 100px; padding:15px; transform:translate(-50%,-50%);  background-color:white;"
      >
        <div style="padding:12px">
          <input
            id="renameInputText"
            type="text"
            style="
        background: transparent;
        padding: 12px;
        font-size: var(--theme-font-size-4, var(--default-theme-font-size-4));
        outline: none;
        border: 1px solid var(--theme-border-color, var(--default-theme-border-color));
        border-radius: var(--theme-radius, var(--default-theme-radius));
        color: var(--theme-color-1, var(--default-theme-color-1));
        font-weight: var(--theme-semibold, var(--default-theme-semibold));
        font-size: var(--theme-font-size-3, var(--default-theme-font-size-3));
        font-family: var(--theme-font, var(--default-theme-font));"
          />
        </div>

        <div
          style="background: var(--theme-background-3, var(--default-theme-background-3));
        padding: 6px 12px;
        font-size: var(--theme-font-size-4, var(--default-theme-font-size-4));
        color: var(--theme-color-3, var(--default-theme-color-3));
        font-weight: var(--theme-semibold, var(--default-theme-semibold));
        display: flex;
        gap: 12px;"
        >
          <span data-v-6b991279="">⏎ Select</span>
        </div>
      </div>
    </div>
  `;
};
