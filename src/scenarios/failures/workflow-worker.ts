import { Console, Effect } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { ReroutePurchaseOrderWorkflow } from "../../domain/purchasing/workflows/reroute-purchase-order"
import { migrate } from "../../infra/database/migrations/migrate"
import { resetDemo } from "../../infra/database/seed/reset-demo"
import { layer, layerCrashAfterCreate } from "../../infra/runtime/app-layer"

const crash = process.argv.includes("--crash")
const reset = process.argv.includes("--reset")

const program = Effect.gen(function*() {
  yield* migrate
  if (reset) yield* resetDemo

  const result = yield* ReroutePurchaseOrderWorkflow.execute({
    runId: "crash-resume-fixture-v1",
    principalId: "u-101",
    partId: "RT-4471",
    originalPoId: "PO-77812",
    productionOrderId: "4812",
    alternateSupplierId: "S-Z",
    quantity: 400
  })

  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<any>`SELECT COUNT(*) AS count FROM purchase_orders WHERE po_id LIKE 'PO-R-%'`
  yield* Console.log(JSON.stringify({ result, replacementPoCount: rows[0]?.count ?? 0 }))
})

Effect.runPromise(program.pipe(Effect.provide(crash ? layerCrashAfterCreate : layer)))
