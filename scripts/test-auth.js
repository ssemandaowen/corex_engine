"use strict";
require("module-alias/register");
require("dotenv").config({ quiet: true });
const http = require("http");

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: "localhost",
      port: 3000,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = "";
      res.on("data", (d) => raw += d);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  try {
    const signin = await post("/api/auth/signin", {
      email: "admin@corex.local",
      password: "ChangeMe123!",
    });
    console.log("Signin:", JSON.stringify(signin, null, 2));
    
    if (signin?.success && signin?.payload?.token) {
      const token = signin.payload.token;
      
      const me = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: "localhost",
          port: 3000,
          path: "/api/auth/me",
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        }, (res) => {
          let raw = "";
          res.on("data", (d) => raw += d);
          res.on("end", () => { try { resolve(JSON.parse(raw)); } catch { resolve(raw); } });
        });
        req.on("error", reject);
        req.end();
      });
      console.log("Me:", JSON.stringify(me, null, 2));
      
      const strategies = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: "localhost",
          port: 3000,
          path: "/api/strategies",
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        }, (res) => {
          let raw = "";
          res.on("data", (d) => raw += d);
          res.on("end", () => { try { resolve(JSON.parse(raw)); } catch { resolve(raw); } });
        });
        req.on("error", reject);
        req.end();
      });
      console.log("Strategies:", JSON.stringify(strategies, null, 2));
    }
  } catch (e) {
    console.log("Error:", e.message);
  }
})();
