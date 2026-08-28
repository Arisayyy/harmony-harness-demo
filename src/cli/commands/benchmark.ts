import { Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { BenchmarkRunner } from "../../harness/evaluation/reporting/benchmark-runner"
import { migrate } from "../../infra/database/migrations/migrate"

const live = Command.make("live", {}, () => Effect.gen(function*() {
  yield* migrate
  const runner = yield* BenchmarkRunner
  yield* runner.live
}))

const replay = Command.make("replay", {}, () => Effect.gen(function*() {
  yield* migrate
  const runner = yield* BenchmarkRunner
  yield* runner.replay
}))

export const benchmark = Command.make("benchmark").pipe(Command.withSubcommands([live, replay]))
