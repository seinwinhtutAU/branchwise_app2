# Master Data

The reference lists everything else on the wholesale side picks from — products, and the
simple named entities (suppliers, customers, cargo companies, carriers, destinations, receiving
gates).

## Models (`app/wholesale/models/master_data.py`)

A `_NamedMasterData` abstract base (`id`, `name`, `active`, timestamps) backs five simple
reference tables: `WholesaleSupplier` (+`phone`, `address`), `WholesaleCustomer` (+`phone`,
`address`), `WholesaleCargoCompany`, `WholesaleCarrier`, `WholesaleDestination`,
`WholesaleReceivingGate`. All of them unique on `name` except `WholesaleCustomer`, which isn't
uniqued (two customers can share a name).

`WholesaleProduct` (table `wholesale_products`) is the shared product catalog used by every
other screen: `stock_code` (unique), `description`, `product_group`, `default_unit`,
`default_unit_conversions`, `active`.

## `get_or_create_product` — the catalog's actual entry point

Every screen that types a stock code on a line (Supplier Vouchers, Customer Orders, Receiving)
calls `get_or_create_product()` (`app/wholesale/services/master_data.py`) to auto-populate the
catalog the first time a code is used anywhere in the wholesale workflow. An existing catalog
row is **never overwritten** by this path — only a brand-new stock code gets a row — so a typo
on one line can't corrupt the shared product record other lines/screens already trust.

## Soft delete only

Every `DELETE` endpoint here sets `active = False`; nothing is ever hard-deleted.
Duplicate-name/stock-code conflicts are handled by catching the resulting `IntegrityError`.

## Endpoints

All under `/api/wholesale`, gated by `require_wholesale`, all list endpoints accepting
`search`/`active_only`/`page`/`page_size` and returning `X-Total-Count`:

- **Products**: `GET`/`POST /products`, `GET`/`PATCH`/`DELETE /products/{id}`.
- **Suppliers**: `GET`/`POST /suppliers`, `GET`/`PATCH`/`DELETE /suppliers/{id}` (with `phone`/
  `address`).
- **Customers**: `GET`/`POST /customers`, `GET`/`PATCH`/`DELETE /customers/{id}` (with `phone`/
  `address`).
- **Simple named entities** — each registered via a `_register_simple_entity_routes()` factory
  (same five verbs, `name`+`active` only): `/cargo-companies`, `/carriers`, `/destinations`,
  `/receiving-gates`.

## Frontend

`MasterDataPage.tsx` — one screen with a tab per entity type (products, suppliers, customers,
cargo companies, carriers, destinations, receiving gates), search plus active/inactive filter,
inline create/edit forms. `masterData.ts` holds the wire types; `masterDataApi.ts` holds the
CRUD wrappers for all seven entity types.
