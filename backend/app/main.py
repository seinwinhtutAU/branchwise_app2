from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import (
    allocation,
    auth,
    branches,
    data_overview,
    factory_vouchers,
    health,
    imports,
    inventory,
    orders,
    purchases,
    sales,
    settings,
    warnings,
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
    app.include_router(orders.router)
    app.include_router(inventory.router)
    app.include_router(allocation.router)
    app.include_router(imports.router)
    app.include_router(branches.router)
    app.include_router(data_overview.router)
    app.include_router(sales.router)
    app.include_router(purchases.router)
    app.include_router(factory_vouchers.router)
    app.include_router(warnings.router)
    app.include_router(settings.router)

    return app


app = create_app()
