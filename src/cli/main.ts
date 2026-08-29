import * as BunServices from "@effect/platform-bun/BunServices"
import { Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { layer } from "../infra/runtime/app-layer"
import { runDemo } from "../scenarios/run-demo"
import { benchmark } from "./commands/benchmark"
import { approval, audit, clock, run } from "./commands/operations"

const demo = Command.make("demo", {}, () => runDemo).pipe(Command.withDescription("Run Scenario A, Tuesday follow-up, Scenario B, and failure fixtures"))

const cli = Command.make("harmony").pipe(
  Command.withDescription("Durable enterprise agent harness demo"),
  Command.withSubcommands([demo, approval, run, audit, clock, benchmark])
)

const main = Command.run(cli, { version: "0.1.0" }).pipe(Effect.provide(layer), Effect.provide(BunServices.layer), Effect.scoped)
Effect.runPromise(main)
