/**
 * Import uploads (POS CSV/XLS exports) are printed-report text, so gzipping them
 * client-side before they go over the wire cuts a slow-connection upload down to a
 * fraction of its size — a 23 MB export is typically 3-5 MB once compressed. The
 * backend's `_read_upload` (backend/app/retail/routers/imports.py) transparently
 * detects the gzip magic bytes and decompresses, so every existing import endpoint
 * (preview, confirm, inspect, general) benefits without any request-shape change —
 * same field name, same original filename, just smaller bytes.
 *
 * Falls back to the original file untouched if `CompressionStream` isn't available
 * or compression fails for any reason — never blocks an upload over this.
 */
export async function maybeCompressFile(file: File): Promise<File> {
  if (typeof CompressionStream === "undefined") {
    return file;
  }
  try {
    const compressedStream = file.stream().pipeThrough(new CompressionStream("gzip"));
    const compressedBlob = await new Response(compressedStream).blob();
    // Skip the swap if compression didn't actually help (e.g. an already-compressed
    // .xlsx, which is itself a zip) — sending the larger of the two is pointless.
    if (compressedBlob.size >= file.size) {
      return file;
    }
    return new File([compressedBlob], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
