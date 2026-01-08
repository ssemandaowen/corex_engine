require("dotenv").config();
const engine = require("./engine");
const server = require("./engine/server"); // Import the Express/HTTP server

async function bootstrap() {
    // Start the trading engine logic
    await engine.start();

    // The server is already set to listen in engine/server.js
    // This provides the active handle that prevents the process from exiting.
}

bootstrap();

process.on("SIGINT", () => {
  engine.stop();
  process.exit();
});