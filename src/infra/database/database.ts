import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient"
import { Effect, Layer } from "effect"
import { AppConfig } from "../config/app-config"

export const layer = Layer.unwrapEffect(
  Effect.map(AppConfig, ({ databasePath }) => SqliteClient.layer({ filename: databasePath }))
)
