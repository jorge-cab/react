import * as babel from '@babel/core';
import puppeteer from 'puppeteer';

export async function measurePerformance(code: any) {
  let options = {
    configFile: false,
    babelrc: false,
    presets: [['@babel/preset-env'], '@babel/preset-react'],
  };

  const parsed = await babel.parseAsync(code, options);

  if (!parsed) {
    throw new Error('Failed to parse code');
  }

  const transpiled = await transformAsync(parsed);

  if (!transpiled) {
    throw new Error('Failed to transpile code');
  }

  const browser = await puppeteer.launch({
    protocolTimeout: 600_000,
  });

  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 720});
  const html = buildHtml(transpiled);
  await page.setContent(html, {waitUntil: 'networkidle0'});

  await page.waitForFunction(
    'window.__RESULT__ !== undefined && (window.__RESULT__.renderTime !== null || window.__RESULT__.error !== null)',
    {timeout: 600_000},
  );

  const result = await page.evaluate(() => {
    return (window as any).__RESULT__;
  });

  await browser.close();
  return result;
}

/**
 * Transform AST into browser-compatible JavaScript
 * @param {babel.types.File} ast - The AST to transform
 * @param {Object} opts - Transformation options
 * @returns {Promise<string>} - The transpiled code
 */
async function transformAsync(ast: babel.types.Node) {
  const result = await babel.transformFromAstAsync(ast, undefined, {
    filename: 'file.jsx',
    presets: [['@babel/preset-env'], '@babel/preset-react'],
    plugins: [
      () => ({
        visitor: {
          ImportDeclaration(path: any) {
            const value = path.node.source.value;
            if (value === 'react' || value === 'react-dom') {
              path.remove();
            }
          },
        },
      }),
    ],
  });

  return result?.code || '';
}

function buildHtml(transpiled: string) {
  const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>React Performance Test</title>
            <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
            <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
            <script src="https://unpkg.com/web-vitals@3.0.0/dist/web-vitals.iife.js"></script>
            <style>
                body { margin: 0; }
                #root { padding: 20px; }
            </style>
        </head>
        <body>
            <div id="root"></div>
            <script>
                window.__RESULT__ = {
                    renderTime: null,
                    webVitals: {},
                    reactProfilerMetrics: {},
                    error: null
                };

                webVitals.onCLS((metric) => { window.__RESULT__.webVitals.cls = metric; });
                webVitals.onLCP((metric) => { window.__RESULT__.webVitals.lcp = metric; });
                webVitals.onINP((metric) => { window.__RESULT__.webVitals.inp = metric; });
                webVitals.onFID((metric) => { window.__RESULT__.webVitals.fid = metric; });
                webVitals.onTTFB((metric) => { window.__RESULT__.webVitals.ttfb = metric; });

                try {
                    ${transpiled}

                    window.App = App;

                    // Render the component to the DOM with profiling
                    const AppComponent = window.App || (() => React.createElement('div', null, 'No App component exported'));

                    const root = ReactDOM.createRoot(document.getElementById('root'), {
                        onUncaughtError: (error, errorInfo) => {
                            window.__RESULT__.error = error;
                        }
                    });

                    const renderStart = performance.now()

                    root.render(
                        React.createElement(React.Profiler, {
                            id: 'App',
                            onRender: (id, phase, actualDuration, baseDuration, startTime, commitTime) => {
                                window.__RESULT__.reactProfilerMetrics.id = id;
                                window.__RESULT__.reactProfilerMetrics.phase = phase;
                                window.__RESULT__.reactProfilerMetrics.actualDuration = actualDuration;
                                window.__RESULT__.reactProfilerMetrics.baseDuration = baseDuration;
                                window.__RESULT__.reactProfilerMetrics.startTime = startTime;
                                window.__RESULT__.reactProfilerMetrics.commitTime = commitTime;
                            }
                        }, React.createElement(AppComponent))
                    );

                    const renderEnd = performance.now();

                    window.__RESULT__.renderTime = renderEnd - renderStart;
                } catch (error) {
                    console.error('Error rendering component:', error);
                    window.__RESULT__.error = {
                        message: error.message,
                        stack: error.stack
                    };
                }
            </script>
            <script>
                window.onerror = function(message, url, lineNumber) {
                    window.__RESULT__.error = message;
                };
            </script>
        </body>
        </html>
    `;

  return html;
}
