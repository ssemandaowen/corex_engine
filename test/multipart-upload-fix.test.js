"use strict";

/**
 * Test for multipart/form-data upload fix
 * Verifies that the Axios client strips Content-Type for FormData
 * so the browser sets the correct multipart boundary.
 */

const axios = require("axios");
const FormData = require("form-data");
const http = require("http");

describe("multipart upload fix", () => {
  let server;
  let serverPort;
  let receivedRequests = [];

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        receivedRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    server.listen(0, () => {
      serverPort = server.address().port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    receivedRequests = [];
  });

  test("FormData request gets multipart/form-data Content-Type with boundary", async () => {
    const client = axios.create({
      baseURL: `http://localhost:${serverPort}`,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Apply the same fix as in client.ts
    client.interceptors.request.use((config) => {
      if (config.data instanceof FormData) {
        delete config.headers["Content-Type"];
      }
      return config;
    });

    const form = new FormData();
    form.append("dataset", Buffer.from("time,open,high,low,close,volume\n1,2,3,4,5,6"), {
      filename: "test.csv",
      contentType: "text/csv",
    });
    form.append("symbol", "TEST");

    await client.post("/upload", form);

    expect(receivedRequests.length).toBe(1);
    const req = receivedRequests[0];
    const contentType = req.headers["content-type"] || "";
    expect(contentType).toMatch(/^multipart\/form-data/);
    expect(contentType).toMatch(/boundary=/);
    expect(req.body.length).toBeGreaterThan(100);
    expect(req.body).toContain("test.csv");
    expect(req.body).toContain("time,open,high,low,close,volume");
  });

  test("JSON request keeps application/json Content-Type", async () => {
    const client = axios.create({
      baseURL: `http://localhost:${serverPort}`,
      headers: {
        "Content-Type": "application/json",
      },
    });

    client.interceptors.request.use((config) => {
      if (config.data instanceof FormData) {
        delete config.headers["Content-Type"];
      }
      return config;
    });

    await client.post("/json", { test: "value" });

    expect(receivedRequests.length).toBe(1);
    const req = receivedRequests[0];
    const contentType = req.headers["content-type"] || "";
    expect(contentType).toBe("application/json");
    expect(req.body).toBe('{"test":"value"}');
  });

  test("FormData WITHOUT fix gets application/json (regression test)", async () => {
    const client = axios.create({
      baseURL: `http://localhost:${serverPort}`,
      headers: {
        "Content-Type": "application/json",
      },
    });
    // NO FIX - Content-Type stays

    const form = new FormData();
    form.append("dataset", Buffer.from("test,data\n1,2"), {
      filename: "test.csv",
      contentType: "text/csv",
    });

    await client.post("/upload-nofix", form);

    expect(receivedRequests.length).toBe(1);
    const req = receivedRequests[0];
    const contentType = req.headers["content-type"] || "";
    // Without fix, axios sends application/json and body becomes "null"
    expect(contentType).toBe("application/json");
    expect(req.body).toBe("null");
  });
});