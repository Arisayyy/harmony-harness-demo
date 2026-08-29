import { Effect } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

export const migrate = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`PRAGMA foreign_keys = ON`

  yield* sql`CREATE TABLE IF NOT EXISTS principals (
    user_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    manager_id TEXT,
    backup_approver_id TEXT,
    scopes_json TEXT NOT NULL,
    po_create_max_value REAL NOT NULL
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS parts (
    part_id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    on_hand REAL NOT NULL,
    daily_usage REAL NOT NULL,
    safety_stock REAL NOT NULL,
    unit_cost REAL NOT NULL,
    lot_tracked INTEGER NOT NULL
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS suppliers (
    supplier_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    approved INTEGER NOT NULL,
    approved_parts_json TEXT NOT NULL,
    lead_time_days INTEGER NOT NULL,
    pricing_json TEXT NOT NULL
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS purchase_orders (
    po_id TEXT PRIMARY KEY,
    part_id TEXT NOT NULL,
    supplier_id TEXT NOT NULL,
    qty REAL NOT NULL,
    unit_price REAL NOT NULL,
    total_value REAL NOT NULL,
    ordered_date TEXT NOT NULL,
    promised_date TEXT NOT NULL,
    status TEXT NOT NULL,
    created_by TEXT NOT NULL
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS production_orders (
    production_order_id TEXT PRIMARY KEY,
    product TEXT NOT NULL,
    qty REAL NOT NULL,
    scheduled_start TEXT NOT NULL,
    scheduled_end TEXT NOT NULL,
    status TEXT NOT NULL,
    line TEXT NOT NULL,
    supervisor_id TEXT NOT NULL,
    components_json TEXT NOT NULL
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS quality_lots (
    lot_id TEXT PRIMARY KEY,
    part_id TEXT NOT NULL,
    qty REAL NOT NULL,
    status TEXT NOT NULL,
    received_date TEXT NOT NULL,
    allocated_to_json TEXT NOT NULL,
    hold_reason TEXT,
    hold_placed_by TEXT,
    hold_placed_on TEXT
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS mail_messages (
    message_id TEXT PRIMARY KEY,
    sender TEXT NOT NULL,
    recipients_json TEXT NOT NULL,
    date TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS calendar_events (
    event_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    title TEXT NOT NULL,
    attendees_json TEXT NOT NULL,
    out_of_office INTEGER NOT NULL
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS business_clock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    now TEXT NOT NULL
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS event_receipts (
    source TEXT NOT NULL,
    event_id TEXT NOT NULL,
    claim_id TEXT NOT NULL,
    received_at TEXT NOT NULL,
    PRIMARY KEY (source, event_id)
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS attention_items (
    attention_id TEXT PRIMARY KEY,
    detector TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    principal_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS agent_runs (
    run_id TEXT PRIMARY KEY,
    attention_id TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    planner_result_json TEXT NOT NULL,
    recommendation_json TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    gate_json TEXT,
    approval_id TEXT,
    status TEXT NOT NULL,
    outcome_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS approvals (
    approval_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    effective_user_id TEXT NOT NULL,
    requested_approver_id TEXT NOT NULL,
    assigned_approver_id TEXT NOT NULL,
    plan_hash TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    policy_reason TEXT NOT NULL,
    status TEXT NOT NULL,
    decision TEXT,
    reviewer_id TEXT,
    reviewer_reason TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS approval_routes (
    route_id TEXT PRIMARY KEY,
    approval_id TEXT NOT NULL,
    from_approver_id TEXT NOT NULL,
    to_approver_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    routed_at TEXT NOT NULL
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS scheduled_work (
    work_id TEXT PRIMARY KEY,
    run_at TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS audit_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    effective_user_id TEXT,
    occurred_at TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    data_json TEXT NOT NULL
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS tool_idempotency (
    idempotency_key TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`

  yield* sql`CREATE TABLE IF NOT EXISTS benchmark_runs (
    benchmark_run_id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    fixture_version TEXT NOT NULL,
    model TEXT NOT NULL,
    planner_version TEXT NOT NULL,
    repetition INTEGER NOT NULL,
    result_json TEXT NOT NULL,
    latency_ms REAL NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    estimated_cost REAL,
    created_at TEXT NOT NULL
  )`
})