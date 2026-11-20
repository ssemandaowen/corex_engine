const { spawnSync } = require('node:child_process');
const path = require('node:path');

describe('frontend Axios multipart upload transport', () => {
  test('uses the real client and browser XHR adapter for FormData and JSON', () => {
    const script = String.raw`
      import { createRequire } from 'node:module';
      import { pathToFileURL } from 'node:url';
      import path from 'node:path';

      const frontendDir = path.resolve(process.cwd(), 'front_end');
      const require = createRequire(import.meta.url);
      const viteEntry = require.resolve('vite', { paths: [frontendDir] });
      const { createServer } = await import(pathToFileURL(viteEntry).href);

      const requests = [];
      class FakeXMLHttpRequest {
        constructor() {
          this.headers = {};
          this.upload = { addEventListener() {} };
          this.status = 200;
          this.statusText = 'OK';
          this.responseText = '{"ok":true}';
          this.onloadend = null;
        }
        open(method, url) {
          this.method = method;
          this.url = url;
        }
        setRequestHeader(name, value) {
          this.headers[name] = value;
        }
        getAllResponseHeaders() {
          return 'content-type: application/json';
        }
        send(data) {
          requests.push({
            method: this.method,
            url: this.url,
            headers: { ...this.headers },
            data,
          });
          queueMicrotask(() => this.onloadend && this.onloadend());
        }
        abort() {}
        addEventListener() {}
      }

      globalThis.window = {
        location: { href: 'http://localhost:3000/' },
        dispatchEvent() {},
      };
      globalThis.document = { cookie: '' };
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { product: 'Browser' },
      });
      globalThis.XMLHttpRequest = FakeXMLHttpRequest;
      globalThis.localStorage = {
        getItem: () => null,
        removeItem: () => {},
      };

      const server = await createServer({
        configFile: false,
        root: frontendDir,
        appType: 'custom',
        server: { middlewareMode: true },
      });

      try {
        const { default: client } = await server.ssrLoadModule('/src/api/client.ts');
        client.defaults.adapter = 'xhr';
        client.defaults.withXSRFToken = false;

        const oldConfigForm = new FormData();
        oldConfigForm.append('dataset', new Blob(['csv-data'], { type: 'text/csv' }), 'sample.csv');
        oldConfigForm.append('symbol', 'EURUSD');
        client.defaults.headers.post['Content-Type'] = 'application/json';
        await client.post('/api/backtest/uploads-old-config', oldConfigForm);
        delete client.defaults.headers.post['Content-Type'];

        const form = new FormData();
        form.append('dataset', new Blob(['csv-data'], { type: 'text/csv' }), 'sample.csv');
        form.append('symbol', 'EURUSD');
        await client.post('/api/backtest/uploads', form);
        await client.post('/api/backtest/example', { symbol: 'EURUSD' });

        console.log(JSON.stringify(requests.map(({ headers, data }) => ({
          isFormData: data instanceof FormData,
          isJsonString: typeof data === 'string',
          contentType: Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1] || null,
        }))));
      } finally {
        await server.close();
      }
    `;

    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      timeout: 30000,
    });

    expect(result.status).toBe(0);
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'Vite browser-transport harness failed');
    }

    const lines = result.stdout.trim().split('\n');
    const requests = JSON.parse(lines[lines.length - 1]);

    expect(requests).toHaveLength(3);
    // Control: the former forced-JSON default turns FormData into JSON.
    expect(requests[0]).toEqual({
      isFormData: false,
      isJsonString: true,
      contentType: 'application/json',
    });
    // Regression: the real browser XHR adapter receives FormData and no explicit content type.
    expect(requests[1]).toEqual({
      isFormData: true,
      isJsonString: false,
      contentType: null,
    });
    // Ordinary JSON payloads still receive Axios's JSON content type.
    expect(requests[2]).toEqual({
      isFormData: false,
      isJsonString: true,
      contentType: 'application/json',
    });
  });
});
