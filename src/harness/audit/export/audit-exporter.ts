import { Context, Effect, FileSystem, Layer } from "effect"
import { AuditRepository } from "../repository/audit-repository"

const writeEvents = (fs: FileSystem.FileSystem, path: string, events: ReadonlyArray<unknown>) => Effect.gen(function*() {
  const separator = path.lastIndexOf("/")
  if (separator > 0) yield* fs.makeDirectory(path.slice(0, separator), { recursive: true })
  yield* fs.writeFileString(path, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`)
})

export class AuditExporter extends Context.Service<AuditExporter, {
  readonly exportRun: (runId: string, path: string) => Effect.Effect<void, unknown>
  readonly exportRuns: (runIds: ReadonlyArray<string>, path: string) => Effect.Effect<void, unknown>
}>()("harmony/audit/AuditExporter") {}

export const layer = Layer.effect(
  AuditExporter,
  Effect.gen(function*() {
    const repository = yield* AuditRepository
    const fs = yield* FileSystem.FileSystem
    return AuditExporter.of({
      exportRun: Effect.fn("AuditExporter.exportRun")(function*(runId, path) {
        const events = yield* repository.listRun(runId)
        yield* writeEvents(fs, path, events)
      }),
      exportRuns: Effect.fn("AuditExporter.exportRuns")(function*(runIds, path) {
        const groups = yield* Effect.forEach(runIds, (runId) => repository.listRun(runId), { concurrency: 1 })
        yield* writeEvents(fs, path, groups.flat())
      })
    })
  })
)
