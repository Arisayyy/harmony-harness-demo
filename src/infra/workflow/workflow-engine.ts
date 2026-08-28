import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import { Layer } from "effect"
import { ClusterWorkflowEngine, SingleRunner } from "effect/unstable/cluster"

const runner = SingleRunner.layer({
  runnerStorage: "sql",
  shardingConfig: {
    availableShardGroups: ["default", "workflow"],
    assignedShardGroups: ["default", "workflow"]
  }
})

export const layer = ClusterWorkflowEngine.layer.pipe(
  Layer.provideMerge(runner),
  Layer.provide(BunCrypto.layer)
)
