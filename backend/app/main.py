from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth, branches, health, settings
from app.retail.routers import (
    chat,
    dashboard,
    data_overview,
    import_health,
    imports,
    inventory,
    purchasing,
    purchases,
    sales,
    warnings,
)
from app.wholesale.routers import (
    finance as wholesale_finance,
    inventory as wholesale_inventory,
    master_data as wholesale_master_data,
    monitoring as wholesale_monitoring,
    orders as wholesale_orders,
    receivings as wholesale_receivings,
    reports as wholesale_reports,
    shipments as wholesale_shipments,
    supplier_vouchers as wholesale_supplier_vouchers,
    write_offs as wholesale_write_offs,
)


def create_app() -> FastAPI:
    app = FastAPI(title="branchwise-app2 backend")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(inventory.router)
    app.include_router(imports.router)
    app.include_router(import_health.router)
    app.include_router(branches.router)
    app.include_router(data_overview.router)
    app.include_router(sales.router)
    app.include_router(purchases.router)
    app.include_router(purchasing.router)
    app.include_router(warnings.router)
    app.include_router(settings.router)
    app.include_router(chat.router)
    app.include_router(dashboard.router)
    app.include_router(wholesale_shipments.router)
    app.include_router(wholesale_receivings.router)
    app.include_router(wholesale_supplier_vouchers.router)
    app.include_router(wholesale_orders.router)
    app.include_router(wholesale_inventory.router)
    app.include_router(wholesale_master_data.router)
    app.include_router(wholesale_monitoring.router)
    app.include_router(wholesale_finance.router)
    app.include_router(wholesale_write_offs.router)
    app.include_router(wholesale_reports.router)

    return app


app = create_app()
