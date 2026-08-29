import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient"
import { Effect, Layer } from "effect"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { AppConfig } from "../config/app-config"

const ensureDatabaseDirectory = (databasePath: string) => {
  if (databasePath === ":memory:") return
  const parent = dirname(databasePath)
  if (parent !== ".") mkdirSync(parent, { recursive: true })
}

export const layer = Layer.unwrap(
  Effect.map(AppConfig, ({ databasePath }) => {
    ensureDatabaseDirectory(databasePath)
    return SqliteClient.layer({ filename: databasePath })
  })
)
