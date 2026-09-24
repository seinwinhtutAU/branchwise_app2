import logging
from functools import lru_cache
from typing import Any

from app.config import get_settings

logger = logging.getLogger(__name__)

try:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError

    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False
    ClientError = Exception


class R2StorageService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._client: Any = None

    @property
    def is_configured(self) -> bool:
        return bool(
            BOTO3_AVAILABLE
            and self.settings.r2_account_id
            and self.settings.r2_access_key_id
            and self.settings.r2_secret_access_key
            and self.settings.r2_bucket
        )

    def _get_client(self) -> Any:
        if not self.is_configured:
            return None
        if self._client is None:
            endpoint_url = f"https://{self.settings.r2_account_id}.r2.cloudflarestorage.com"
            self._client = boto3.client(
                "s3",
                endpoint_url=endpoint_url,
                aws_access_key_id=self.settings.r2_access_key_id,
                aws_secret_access_key=self.settings.r2_secret_access_key,
                config=Config(signature_version="s3v4"),
                region_name="auto",
            )
        return self._client

    def upload_file_bytes(
        self,
        data: bytes,
        key: str,
        content_type: str = "application/octet-stream",
    ) -> str | None:
        """Uploads raw bytes to Cloudflare R2 bucket. Returns the key or None on failure."""
        client = self._get_client()
        if client is None:
            logger.warning("R2 storage client not configured or boto3 missing; skipping upload of %s", key)
            return None

        try:
            client.put_object(
                Bucket=self.settings.r2_bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
            )
            logger.info("Successfully uploaded %s (%d bytes) to R2", key, len(data))
            return key
        except ClientError as e:
            logger.error("Failed to upload %s to Cloudflare R2: %s", key, e)
            return None
        except Exception as e:
            logger.error("Unexpected error uploading %s to R2: %s", key, e)
            return None

    def download_file_bytes(self, key: str) -> tuple[bytes, str] | None:
        """Downloads raw bytes and content-type from Cloudflare R2 bucket."""
        client = self._get_client()
        if client is None:
            logger.warning("R2 storage client not configured; cannot download %s", key)
            return None

        try:
            response = client.get_object(
                Bucket=self.settings.r2_bucket,
                Key=key,
            )
            body = response["Body"].read()
            content_type = response.get("ContentType", "application/octet-stream")
            return body, content_type
        except ClientError as e:
            logger.error("Failed to download %s from Cloudflare R2: %s", key, e)
            return None
        except Exception as e:
            logger.error("Unexpected error downloading %s from R2: %s", key, e)
            return None

@lru_cache
def get_storage_service() -> R2StorageService:
    return R2StorageService()
