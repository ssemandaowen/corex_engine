require("dotenv").config()   // <-- MUST be first
const engine = require("./engine")

engine.start()

process.on("SIGINT", () => {
  engine.stop()
  process.exit()
})
