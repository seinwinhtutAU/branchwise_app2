from app.retail.services.preview_storage import (
    read_preview_page,
    read_preview_warnings,
    upload_preview_pages,
)


class FakeStorage:
    is_configured = True

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def upload_file_bytes(self, data: bytes, key: str, content_type: str) -> str:
        self.objects[key] = data
        return key

    def download_file_bytes(self, key: str) -> tuple[bytes, str] | None:
        data = self.objects.get(key)
        return (data, "application/json") if data else None


def test_stores_and_reads_one_preview_tab_page_at_a_time():
    storage = FakeStorage()
    preview = {
        "origin": {"rows": [["raw-1"], ["raw-2"]], "row_issues": [[], []]},
        "clean": {
            "columns": ["StockCode"],
            "rows": [{"StockCode": "A"}, {"StockCode": "B"}],
            "row_issues": [[], [{"column": "StockCode", "message": "Invalid"}]],
        },
    }

    assert upload_preview_pages(storage, "batch-1", preview)
    result = read_preview_page(storage, "batch-1", "clean", 1)
    assert result is not None
    manifest, page = result
    assert manifest["clean"]["total_rows"] == 2
    assert page == {
        "rows": [{"StockCode": "A"}, {"StockCode": "B"}],
        "row_issues": [[], [{"column": "StockCode", "message": "Invalid"}]],
        "page": 1,
        "page_size": 50,
    }
    assert read_preview_warnings(storage, "batch-1", "clean") == [1]
