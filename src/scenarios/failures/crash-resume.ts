import { Console, Data, Effect, FileSystem } from "effect"
import { ChildProcess } from "effect/unstable/process"

export class CrashResumeFailure extends Data.TaggedError("CrashResumeFailure")<{
  readonly phase: "crash" | "resume"
  readonly exitCode: number
}> {}

const databasePath = ".data/harmony-crash.db"
const worker = "src/scenarios/failures/workflow-worker.ts"

export const runCrashResumeFixture = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(".data", { recursive: true })
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) yield* fs.remove(path, { force: true })

  yield* Console.log("  restart safety     killing a worker after durable step 03")
  const first = yield* ChildProcess.make("bun", ["run", worker, "--reset", "--crash"], {
    env: { DATABASE_PATH: databasePath },
    extendEnv: true,
    stdout: "inherit",
    stderr: "inherit"
  })
  const firstCode = Number(yield* first.exitCode)
  if (firstCode === 0) return yield* new CrashResumeFailure({ phase: "crash", exitCode: firstCode })

  yield* Console.log("  restart safety     starting a fresh worker against the same SQLite state")
  const second = yield* ChildProcess.make("bun", ["run", worker], {
    env: { DATABASE_PATH: databasePath },
    extendEnv: true,
    stdout: "inherit",
    stderr: "inherit"
  })
  const secondCode = Number(yield* second.exitCode)
  if (secondCode !== 0) return yield* new CrashResumeFailure({ phase: "resume", exitCode: secondCode })

  yield* Console.log("  restart safety     resumed without creating a second replacement PO")
})
