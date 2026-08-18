"use strict";
require("module-alias/register");
require("dotenv").config({ quiet: true });
const db = require("@core/services/postgres");

(async () => {
  try {
    const r = await db.query("SELECT id, email, role, status FROM users WHERE email = $1", ["admin@corex.local"]);
    console.log("Admin user:", JSON.stringify(r.rows, null, 2));
  } catch (e) {
    console.log("DB ERROR:", e.message);
  }
})();
