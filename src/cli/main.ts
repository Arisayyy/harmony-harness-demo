import * as BunServices from "@effect/platform-bun/BunServices"
import { Effect } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { layer as fixtureLayer } from "../environments/demo/fixture-layer"
import { layer as liveLayer } from "../environments/demo/live-layer"
import { runDemo } from "../scenarios/run-demo"
import { benchmark } from "./commands/benchmark"
import { approval, audit, clock, run } from "./commands/operations"

const demo = Command.make("demo", {
  auto: Flag.boolean("auto").pipe(Flag.withDefault(false), Flag.withDescription("Run without interactive approval prompts"))
}, ({ auto }) => runDemo(auto ? "auto" : "interactive")).pipe(Command.withDescription("Run the interactive operator demo (use --auto for CI)"))

const cli = Command.make("harmony").pipe(
  Command.withDescription("Durable enterprise agent harness demo"),
  Command.withSubcommands([demo, approval, run, audit, clock, benchmark])
)

// `demo:auto` must work in Windows shells too, so its fixture selection is
// derived from the CLI flag instead of an inline POSIX environment assignment.
const useFixtureLayer = process.env.HARMONY_PLANNER === "fixture" || process.argv.includes("--auto")
const applicationLayer = useFixtureLayer ? fixtureLayer : liveLayer
const main = Command.run(cli, { version: "0.1.0" }).pipe(Effect.provide(applicationLayer), Effect.provide(BunServices.layer), Effect.scoped)
Effect.runPromise(main)
