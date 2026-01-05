require("dotenv").config()

if (!process.env.PORT) {
  throw new Error("PORT not set")
}

module.exports = {
  port: Number(process.env.PORT),
  env: process.env.NODE_ENV || "dev"
}
