import * as BunServices from "@effect/platform-bun/BunServices"
import { Layer } from "effect"
import { layer as toolCatalogLayer } from "../../app/tool-catalog-layer"
import { layer as supplyContextLayer } from "../../domain/purchasing/context/supply-risk-context"
import { layer as supplyDetectorLayer } from "../../domain/purchasing/detectors/supply-risk-detector"
import { layer as rerouteWorkflowLayer } from "../../domain/purchasing/workflows/reroute-purchase-order"
import { layer as qualityContextLayer } from "../../domain/quality/context/quality-hold-context"
import { layer as qualityDetectorLayer } from "../../domain/quality/detectors/quality-hold-detector"
import { layer as attentionLayer } from "../../harness/agent/context/attention-repository"
import { layer as agentHarnessLayer } from "../../harness/agent/execution/agent-harness"
import { Planner } from "../../harness/agent/planning/planner"
import { layer as approvalRoutingLayer } from "../../harness/approvals/routing/backup-routing"
import { layer as approvalRepositoryLayer } from "../../harness/approvals/service/approval-repository"
import { layer as approvalServiceLayer } from "../../harness/approvals/service/approval-service"
import { layer as approvalWorkflowLayer } from "../../harness/approvals/service/approval-workflow"
import { layer as auditExporterLayer } from "../../harness/audit/export/audit-exporter"
import { layer as auditRepositoryLayer } from "../../harness/audit/repository/audit-repository"
import { layer as auditLogLayer } from "../../harness/audit/service/audit-log"
import { layer as gateLayer } from "../../harness/authorization/policy/gate"
import { layer as principalDirectoryLayer } from "../../harness/authorization/permissions/principal-directory"
import { layer as benchmarkLayer } from "../../harness/evaluation/reporting/benchmark-runner"
import { layer as runRepositoryLayer } from "../../harness/memory/durable/run-repository"
import { layer as businessClockLayer } from "../../harness/scheduling/model/business-clock"
import { layer as followupLayer } from "../../harness/scheduling/service/followup-dispatcher"
import { layer as scheduledWorkLayer } from "../../harness/scheduling/service/scheduled-work"
import { layer as toolRuntimeLayer } from "../../harness/tools/runtime/tool-runtime"
import { layerNoop, layerProcessKill, type CrashControl } from "../../harness/workflows/runtime/crash-control"
import { layer as calendarLayer } from "../../integrations/calendar/sqlite-calendar-provider"
import { layer as erpLayer } from "../../integrations/erp/sqlite-erp-provider"
import { layer as mailLayer } from "../../integrations/mail/sqlite-mail-provider"
import { layer as openRouterClientLayer } from "../../integrations/openrouter/client"
import { layer as openRouterPlannerLayer } from "../../integrations/openrouter/openrouter-planner"
import { layer as fixturePlannerLayer } from "../../scenarios/fixture-planner"
import { layer as configLayer } from "../config/app-config"
import { layer as databaseLayer } from "../database/database"
import { layer as workflowEngineLayer } from "../workflow/workflow-engine"

type ClosedLayer = Layer.Layer<any, any, never>
type PlannerProvider = (base: ClosedLayer) => Layer.Layer<Planner, any, never>

const build = (crashLayer: Layer.Layer<CrashControl>, plannerProvider: PlannerProvider) => {
  const database = databaseLayer.pipe(Layer.provide(configLayer))
  const infrastructure = Layer.mergeAll(configLayer, BunServices.layer, database, crashLayer)
  const state = Layer.mergeAll(businessClockLayer, principalDirectoryLayer, attentionLayer, runRepositoryLayer, approvalRepositoryLayer, auditRepositoryLayer, erpLayer, mailLayer, calendarLayer).pipe(Layer.provideMerge(infrastructure))
  const support = Layer.mergeAll(scheduledWorkLayer, auditLogLayer, supplyContextLayer, qualityContextLayer).pipe(Layer.provideMerge(state))
  const catalog = toolCatalogLayer.pipe(Layer.provideMerge(support))
  const safety = Layer.mergeAll(toolRuntimeLayer, gateLayer).pipe(Layer.provideMerge(catalog))
  const engine = workflowEngineLayer.pipe(Layer.provideMerge(safety))
  const workflows = Layer.mergeAll(approvalWorkflowLayer, rerouteWorkflowLayer).pipe(Layer.provideMerge(engine))
  const planner = plannerProvider(workflows)
  const approvals = Layer.mergeAll(approvalServiceLayer, approvalRoutingLayer).pipe(Layer.provideMerge(planner))
  return Layer.mergeAll(agentHarnessLayer, supplyDetectorLayer, qualityDetectorLayer, followupLayer, auditExporterLayer, benchmarkLayer).pipe(Layer.provideMerge(approvals))
}

const livePlanner: PlannerProvider = (base) => {
  const aiClient = openRouterClientLayer.pipe(Layer.provideMerge(base))
  return openRouterPlannerLayer.pipe(Layer.provideMerge(aiClient))
}
const fixturePlanner: PlannerProvider = (base) => fixturePlannerLayer.pipe(Layer.provideMerge(base))

export const layer = build(layerNoop, livePlanner)
export const layerFixturePlanner = build(layerNoop, fixturePlanner)
export const layerCrashAfterCreate = build(layerProcessKill("03-create-new-po"), livePlanner)
export const layerCrashAfterCreateFixture = build(layerProcessKill("03-create-new-po"), fixturePlanner)
