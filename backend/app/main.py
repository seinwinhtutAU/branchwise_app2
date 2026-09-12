from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import (
    auth,
    branches,
    chat,
    dashboard,
    data_overview,
    health,
    import_health,
    imports,
    inventory,
    purchases,
    sales,
    settings,
    warnings,
    wholesale_receivings,
    wholesale_shipments,
    wholesale_supplier_vouchers,
    wholesale_orders,
    wholesale_inventory,
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
    app.include_router(warnings.router)
    app.include_router(settings.router)
    app.include_router(chat.router)
    app.include_router(dashboard.router)
    app.include_router(wholesale_shipments.router)
    app.include_router(wholesale_receivings.router)
    app.include_router(wholesale_supplier_vouchers.router)
    app.include_router(wholesale_orders.router)
    app.include_router(wholesale_inventory.router)

    return app


app = create_app()
