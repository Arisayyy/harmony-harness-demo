import { Effect } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"

const stringify = JSON.stringify

export const resetDemo = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql.withTransaction(Effect.gen(function*() {
    yield* sql`DELETE FROM benchmark_runs`
    yield* sql`DELETE FROM tool_idempotency`
    yield* sql`DELETE FROM audit_events`
    yield* sql`DELETE FROM scheduled_work`
    yield* sql`DELETE FROM approval_routes`
    yield* sql`DELETE FROM approvals`
    yield* sql`DELETE FROM attention_items`
    yield* sql`DELETE FROM calendar_events`
    yield* sql`DELETE FROM mail_messages`
    yield* sql`DELETE FROM quality_lots`
    yield* sql`DELETE FROM production_orders`
    yield* sql`DELETE FROM purchase_orders`
    yield* sql`DELETE FROM suppliers`
    yield* sql`DELETE FROM parts`
    yield* sql`DELETE FROM principals`
    yield* sql`DELETE FROM business_clock`

    yield* sql`INSERT INTO business_clock (id, now) VALUES (1, ${"2026-09-02T09:00:00-06:00"})`

    yield* sql`INSERT INTO principals VALUES (
      ${"u-100"}, ${"Javier Montes"}, ${"Director, Supply Chain"}, ${null}, ${"u-103"},
      ${stringify(["erp:po:read", "erp:po:create", "erp:po:cancel", "erp:production:read", "mail:read", "mail:send", "calendar:read", "production:notify"])}, ${100000}
    )`
    yield* sql`INSERT INTO principals VALUES (
      ${"u-101"}, ${"Elena Vargas"}, ${"Purchasing Manager"}, ${"u-100"}, ${"u-102"},
      ${stringify(["erp:part:read", "erp:supplier:read", "erp:po:read", "erp:po:create", "erp:po:cancel", "erp:production:read", "mail:read", "mail:send", "calendar:read", "production:notify"])}, ${25000}
    )`
    yield* sql`INSERT INTO principals VALUES (
      ${"u-102"}, ${"Marco Ruiz"}, ${"Senior Buyer"}, ${"u-100"}, ${null},
      ${stringify(["erp:part:read", "erp:supplier:read", "erp:po:read", "erp:po:create", "erp:po:cancel", "erp:production:read", "mail:read", "mail:send", "calendar:read", "production:notify"])}, ${25000}
    )`
    yield* sql`INSERT INTO principals VALUES (
      ${"u-202"}, ${"Sofía Navarro"}, ${"Quality Manager"}, ${"u-203"}, ${"u-204"},
      ${stringify(["erp:part:read", "erp:production:read", "erp:quality:read", "erp:quality:reallocate", "mail:send", "calendar:read", "production:notify", "purchasing:flag-shortage"])}, ${0}
    )`
    yield* sql`INSERT INTO principals VALUES (
      ${"u-301"}, ${"Daniel Soto"}, ${"Production Supervisor"}, ${"u-302"}, ${null},
      ${stringify(["erp:production:read", "mail:read", "calendar:read"])}, ${0}
    )`

    yield* sql`INSERT INTO parts VALUES (${"RT-4471"}, ${"12V retractable-cover drive motor, RH"}, ${150}, ${30}, ${20}, ${42}, ${0})`
    yield* sql`INSERT INTO parts VALUES (${"RT-1180"}, ${"Powder-coated latch carrier, LH"}, ${180}, ${12}, ${24}, ${18.4}, ${1})`
    yield* sql`INSERT INTO parts VALUES (${"RT-2210"}, ${"M8 zinc flange bolt kit"}, ${2400}, ${75}, ${300}, ${1.1}, ${0})`

    yield* sql`INSERT INTO suppliers VALUES (
      ${"S-Y"}, ${"Sierra Motion Components"}, ${"logistics@sierramotion.example"}, ${1},
      ${stringify(["RT-4471"])}, ${4}, ${stringify([{ partId: "RT-4471", unitPrice: 42 }])}
    )`
    yield* sql`INSERT INTO suppliers VALUES (
      ${"S-Z"}, ${"Bajío Electromech"}, ${"orders@bajioelectromech.example"}, ${1},
      ${stringify(["RT-4471"])}, ${2}, ${stringify([{ partId: "RT-4471", unitPrice: 46.5 }])}
    )`
    yield* sql`INSERT INTO suppliers VALUES (
      ${"S-Q"}, ${"Volta Direct Trading"}, ${"sales@voltadirect.example"}, ${0},
      ${stringify(["RT-2210"])}, ${1}, ${stringify([{ partId: "RT-4471", unitPrice: 34.8 }])}
    )`

    yield* sql`INSERT INTO purchase_orders VALUES (
      ${"PO-77812"}, ${"RT-4471"}, ${"S-Y"}, ${400}, ${42}, ${16800}, ${"2026-08-26"}, ${"2026-09-04"}, ${"open"}, ${"u-101"}
    )`
    yield* sql`INSERT INTO purchase_orders VALUES (
      ${"PO-77901"}, ${"RT-2210"}, ${"S-Z"}, ${1000}, ${1.08}, ${1080}, ${"2026-08-29"}, ${"2026-09-03"}, ${"open"}, ${"u-102"}
    )`

    yield* sql`INSERT INTO production_orders VALUES (
      ${"4812"}, ${"Retractable Tonneau Cover Assembly"}, ${10}, ${"2026-09-07"}, ${"2026-09-10"}, ${"planned"}, ${"Line 2"}, ${"u-301"},
      ${stringify([{ partId: "RT-4471", qty: 120 }, { partId: "RT-2210", qty: 30 }])}
    )`
    yield* sql`INSERT INTO production_orders VALUES (
      ${"4820"}, ${"Latch Rail Assembly"}, ${40}, ${"2026-09-05"}, ${"2026-09-06"}, ${"planned"}, ${"Line 4"}, ${"u-301"},
      ${stringify([{ partId: "RT-1180", qty: 80, lotId: "L-2093" }])}
    )`

    yield* sql`INSERT INTO quality_lots VALUES (
      ${"L-2093"}, ${"RT-1180"}, ${100}, ${"hold"}, ${"2026-08-28"}, ${stringify(["4820"])},
      ${"Surface finish 3.4 Ra vs spec 3.2 Ra"}, ${"u-202"}, ${"2026-09-02"}
    )`
    yield* sql`INSERT INTO quality_lots VALUES (
      ${"L-2094"}, ${"RT-1180"}, ${120}, ${"good"}, ${"2026-08-30"}, ${stringify([])}, ${null}, ${null}, ${null}
    )`
    yield* sql`INSERT INTO quality_lots VALUES (
      ${"L-2087"}, ${"RT-1180"}, ${20}, ${"good"}, ${"2026-08-25"}, ${stringify(["4804"])}, ${null}, ${null}, ${null}
    )`

    yield* sql`INSERT INTO mail_messages VALUES (
      ${"M-NOISE-1"}, ${"facilities.gdl@realtruck.example"}, ${stringify(["elena.vargas@realtruck.example"])},
      ${"2026-09-02T08:12:00-06:00"}, ${"Parking access — visitor lot"}, ${"The west visitor lot will be closed after 18:00 Thursday."}
    )`
    yield* sql`INSERT INTO mail_messages VALUES (
      ${"M-NOISE-2"}, ${"sales@voltadirect.example"}, ${stringify(["elena.vargas@realtruck.example"])},
      ${"2026-09-02T08:38:00-06:00"}, ${"September motor pricing"}, ${"We can quote RT-4471-equivalent motors at 34.80 USD with next-day delivery. Contact us if useful."}
    )`

    yield* sql`INSERT INTO calendar_events VALUES (
      ${"E-002"}, ${"u-101"}, ${"2026-09-03T00:00:00-06:00"}, ${"2026-09-04T23:59:59-06:00"},
      ${"Out of office — supplier site visit"}, ${stringify([])}, ${1}
    )`
    yield* sql`INSERT INTO calendar_events VALUES (
      ${"E-007"}, ${"u-101"}, ${"2026-09-02T13:30:00-06:00"}, ${"2026-09-02T14:00:00-06:00"},
      ${"Weekly sourcing review"}, ${stringify(["u-102"])}, ${0}
    )`
  }))
})
