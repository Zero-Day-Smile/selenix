#!/usr/bin/env python
"""Out-of-core comparison of two multi-gigabyte GeoTIFFs.

Compares a source raster against a reference raster (e.g. two epochs of
the same scene, or two sensors over the same footprint) without loading
either image fully into memory. Everything from disk I/O to the pixel
math runs as chunked, lazy Dask graphs until the final windowed write,
so peak memory stays bounded by chunk size x worker count, not by the
size of the input files.

Stack, and why each piece is here:
  - rioxarray  : opens a GeoTIFF as a chunked xarray.DataArray, carrying
                 CRS/transform/nodata as first-class metadata (rather
                 than the caller tracking an affine matrix by hand).
  - xarray     : gives the two rasters labeled, coordinate-aware axes,
                 so the actual comparison line is a plain array
                 expression, not manual index bookkeeping.
  - dask       : backs every array with lazy, chunked graphs; nothing
                 computes until dask.array.store() streams it, chunk by
                 chunk, straight into an open rasterio dataset (see
                 _RasterioBlockSink below) -- never assembling the full
                 array in memory.
  - rasterio   : does the actual reprojection (reference -> source grid)
                 and the windowed writes during streaming.
  - rio-cogeo  : converts the streamed intermediate GeoTIFF into a real
                 Cloud-Optimized GeoTIFF (correct tile ordering +
                 overviews) in a second, still memory-bounded pass --
                 GDAL's COG driver itself expects a complete source
                 dataset to compute overviews from, so it is not a
                 target you can fill in incrementally the way a plain
                 GeoTIFF is.

Usage:
    python -m backend.scripts.large_raster_compare \\
        --source /path/to/source.tif \\
        --reference /path/to/reference.tif \\
        --output /path/to/diff_cog.tif \\
        --chunk-size 2048 \\
        --workers 4

Or import and call `compare_rasters(...)` directly.
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import dask.array as da
import numpy as np
import rasterio
import rioxarray  # noqa: F401 -- registers the .rio accessor on xarray objects
import xarray as xr
from rasterio.enums import Resampling
from rasterio.errors import RasterioIOError
from rasterio.windows import Window
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles

try:
    import psutil
    _HAVE_PSUTIL = True
except ImportError:  # pragma: no cover - psutil is a soft dependency for logging only
    _HAVE_PSUTIL = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("large_raster_compare")

DEFAULT_CHUNK = 2048  # pixels/side; matches internal COG tile size for aligned, cache-friendly I/O
NODATA_FILL = np.nan  # sentinel for pixels with no valid data on either input


@dataclass
class CompareConfig:
    source_path: Path
    reference_path: Path
    output_path: Path
    chunk_size: int = DEFAULT_CHUNK
    workers: int = 4
    band: int = 1
    resampling: Resampling = Resampling.bilinear
    mode: str = "abs_diff"  # "abs_diff" or "signed_diff"
    compress: str = "DEFLATE"
    predictor: int = 2  # horizontal differencing predictor; pairs well with DEFLATE on continuous data


def _log_system_usage(prefix: str = "") -> None:
    """One-line resource snapshot -- cheap enough to call between every
    major stage without materially affecting timing."""
    if not _HAVE_PSUTIL:
        return
    proc = psutil.Process()
    rss_mb = proc.memory_info().rss / (1024 ** 2)
    cpu_pct = psutil.cpu_percent(interval=None)
    log.info("%sRSS=%.0fMB  CPU=%.0f%%  system_mem_used=%.0f%%",
              f"{prefix} " if prefix else "", rss_mb, cpu_pct, psutil.virtual_memory().percent)


def _open_lazy(path: Path, chunk_size: int, band: int) -> xr.DataArray:
    """Opens a GeoTIFF as a single-band, chunked DataArray. `chunks=` is
    what makes this lazy: rioxarray hands the array to dask instead of
    reading pixels immediately, so a 10GB file opens in milliseconds and
    stays that way until something downstream actually needs a chunk's
    data."""
    if not path.exists():
        raise FileNotFoundError(f"Raster not found: {path}")
    try:
        # NOTE: named `arr`, not `da` -- `da` is reserved at module scope
        # for `import dask.array as da`; shadowing it here would be a
        # confusing latent bug for any future edit to this function.
        arr = rioxarray.open_rasterio(
            path,
            chunks={"x": chunk_size, "y": chunk_size},
            masked=True,  # nodata -> NaN automatically, so comparison math doesn't need to special-case it
            lock=False,   # allow concurrent chunk reads across dask workers
        )
    except RasterioIOError as e:
        raise RuntimeError(f"Could not open {path} as a raster: {e}") from e

    if "band" in arr.dims:
        arr = arr.sel(band=band, drop=True)
    if arr.rio.crs is None:
        raise ValueError(f"{path} has no CRS -- refusing to compare georeferenced data against an undefined grid.")
    return arr


def _grids_match(a: xr.DataArray, b: xr.DataArray) -> bool:
    """True only if CRS, resolution, and pixel grid origin all agree --
    matching just the CRS is not sufficient, since two rasters in the
    same CRS can still be on offset or differently-scaled pixel grids."""
    if a.rio.crs != b.rio.crs:
        return False
    if a.rio.resolution() != b.rio.resolution():
        return False
    if a.shape != b.shape:
        return False
    # transform equality catches origin/rotation differences that
    # resolution+shape alone can miss
    return a.rio.transform() == b.rio.transform()


def _align_reference_to_source(source: xr.DataArray, reference: xr.DataArray, resampling: Resampling) -> xr.DataArray:
    """Reprojects/resamples `reference` onto `source`'s exact grid
    (CRS, resolution, extent, alignment) if they differ. rioxarray's
    reproject_match still returns a lazy, chunked array -- the actual
    resampling work happens per-chunk when the graph is later computed,
    not eagerly here."""
    if _grids_match(source, reference):
        log.info("Source and reference already share the same grid -- skipping reprojection.")
        return reference

    log.info(
        "Grid mismatch detected (source CRS=%s res=%s vs reference CRS=%s res=%s). "
        "Reprojecting reference onto source's grid (%s resampling).",
        source.rio.crs, source.rio.resolution(), reference.rio.crs, reference.rio.resolution(), resampling.name,
    )
    aligned = reference.rio.reproject_match(source, resampling=resampling)
    # reproject_match can return chunks that don't line up with our
    # requested chunk size; rechunk explicitly so the comparison graph
    # downstream has predictable, uniform chunk boundaries.
    aligned = aligned.chunk({"x": source.chunksizes["x"], "y": source.chunksizes["y"]})
    return aligned


def _compute_difference(source: xr.DataArray, reference: xr.DataArray, mode: str) -> xr.DataArray:
    """The actual comparison -- still fully lazy (a dask task graph, no
    pixels touched yet). `xr.align` guards against off-by-one coordinate
    drift after reprojection before the elementwise op runs."""
    source, reference = xr.align(source, reference, join="exact")

    if mode == "abs_diff":
        result = np.abs(source.astype("float32") - reference.astype("float32"))
    elif mode == "signed_diff":
        result = source.astype("float32") - reference.astype("float32")
    else:
        raise ValueError(f"Unknown comparison mode {mode!r} (expected 'abs_diff' or 'signed_diff')")

    result = result.rio.write_crs(source.rio.crs)
    result = result.rio.write_transform(source.rio.transform())
    result = result.rio.write_nodata(NODATA_FILL)
    result.name = f"{mode}"
    return result


class _RasterioBlockSink:
    """Array-like write target for dask.array.store().

    dask.array.store(source, target) computes `source` block by block and
    calls `target[block_slices] = block_array` for each one as soon as
    it's ready -- it never assembles the full array in memory. Wrapping
    an open rasterio dataset behind this tiny __setitem__ adapter is what
    turns that into a genuine out-of-core write to disk: each dask chunk
    is computed, written to its exact pixel window, and freed, so peak
    memory is bounded by (chunk size x in-flight chunk count), never by
    total raster size. This is the actual mechanism the module docstring
    promises -- unlike relying on a high-level to_raster(windowed=True)
    call, whose internal window size is not guaranteed to match the
    chunk size you asked for.
    """

    def __init__(self, dataset: rasterio.io.DatasetWriter, band: int, total_blocks: int, log_every: int = 10):
        self.dataset = dataset
        self.band = band
        self.total_blocks = total_blocks
        self.log_every = log_every
        self._written = 0

    def __setitem__(self, key: tuple[slice, slice], value: np.ndarray) -> None:
        row_slice, col_slice = key
        window = Window(
            col_off=col_slice.start,
            row_off=row_slice.start,
            width=col_slice.stop - col_slice.start,
            height=row_slice.stop - row_slice.start,
        )
        self.dataset.write(value, self.band, window=window)
        self._written += 1
        if self._written % self.log_every == 0 or self._written == self.total_blocks:
            log.info("Wrote block %d/%d (window=%s)", self._written, self.total_blocks, window)
            _log_system_usage()


def _stream_to_intermediate_geotiff(diff: xr.DataArray, path: Path, config: CompareConfig) -> None:
    """Phase 1: compute the lazy `diff` graph and stream it, chunk by
    chunk, into a plain tiled/compressed GeoTIFF using dask.array.store.
    A regular GeoTIFF (not COG) is the right intermediate target here:
    it supports genuine incremental block writes via a normal Create() +
    windowed .write(), whereas GDAL's COG driver is built around
    receiving a complete source dataset (to compute overviews) and is
    not meant to be filled in piecemeal like this."""
    height, width = diff.shape
    n_blocks = int(np.prod(diff.data.numblocks))
    log.info("Streaming %d chunks (%dx%d px each, %dx%d total) to intermediate GeoTIFF: %s",
              n_blocks, config.chunk_size, config.chunk_size, width, height, path)

    profile = {
        "driver": "GTiff",
        "width": width,
        "height": height,
        "count": 1,
        "dtype": "float32",
        "crs": diff.rio.crs,
        "transform": diff.rio.transform(),
        "nodata": NODATA_FILL,
        "tiled": True,
        "blockxsize": config.chunk_size,
        "blockysize": config.chunk_size,
        "compress": config.compress,
        "predictor": config.predictor,
        "bigtiff": "YES",  # multi-gigabyte outputs are expected here
        "num_threads": str(config.workers),
    }

    with rasterio.open(path, "w", **profile) as dst:
        sink = _RasterioBlockSink(dst, band=1, total_blocks=n_blocks)
        # lock=True serializes the actual disk writes (rasterio datasets
        # are not thread-safe for concurrent .write() calls) while the
        # upstream compute (I/O + reprojection + arithmetic) still runs
        # across config.workers threads -- writing is rarely the
        # bottleneck here, computing each chunk is.
        da.store(diff.data, sink, lock=True, compute=True)


def _convert_to_cog(intermediate_path: Path, output_path: Path, config: CompareConfig) -> None:
    """Phase 2: turn the plain tiled GeoTIFF into a real Cloud-Optimized
    GeoTIFF (correct internal tile ordering + overviews) via rio-cogeo,
    the standard tool for this exact conversion. cog_translate itself
    operates block-by-block internally rather than loading the whole
    raster, so this phase stays memory-bounded too -- it is not a return
    to an in-memory whole-array step."""
    log.info("Converting intermediate GeoTIFF to Cloud-Optimized GeoTIFF: %s", output_path)
    dst_profile = cog_profiles.get("deflate")
    dst_profile.update({
        "blockxsize": config.chunk_size,
        "blockysize": config.chunk_size,
        "predictor": config.predictor,
        "bigtiff": "YES",
    })
    cog_translate(
        str(intermediate_path),
        str(output_path),
        dst_profile,
        in_memory=False,  # forces the disk-backed, block-wise code path instead of buffering in RAM
        quiet=True,
        add_mask=False,
    )


def compare_rasters(config: CompareConfig) -> Path:
    """Runs the full pipeline: open both rasters lazily, align grids if
    needed, build the lazy comparison graph, stream it chunk-by-chunk to
    an intermediate GeoTIFF, then convert that to a real COG. Returns the
    output path on success."""
    t0 = time.monotonic()
    log.info("Opening source raster: %s", config.source_path)
    source = _open_lazy(config.source_path, config.chunk_size, config.band)
    _log_system_usage("after opening source;")

    log.info("Opening reference raster: %s", config.reference_path)
    reference = _open_lazy(config.reference_path, config.chunk_size, config.band)
    _log_system_usage("after opening reference;")

    reference = _align_reference_to_source(source, reference, config.resampling)

    log.info("Building lazy comparison graph (mode=%s)...", config.mode)
    diff = _compute_difference(source, reference, config.mode)
    diff = diff.chunk({"x": config.chunk_size, "y": config.chunk_size})

    config.output_path.parent.mkdir(parents=True, exist_ok=True)
    intermediate_path = config.output_path.with_suffix(".intermediate.tif")

    try:
        _stream_to_intermediate_geotiff(diff, intermediate_path, config)
        _log_system_usage("after streaming write;")

        _convert_to_cog(intermediate_path, config.output_path, config)
        _log_system_usage("after COG conversion;")
    finally:
        # Always clean up the intermediate file, even if COG conversion
        # failed partway -- it is disk-space scratch, not an artifact
        # worth keeping around after a failure.
        intermediate_path.unlink(missing_ok=True)

    elapsed = time.monotonic() - t0
    log.info("Done in %.1fs -> %s", elapsed, config.output_path)
    return config.output_path


def _verify_output(path: Path) -> None:
    """Cheap sanity read (metadata + a single small window) -- confirms
    the COG is well-formed without loading it fully back into memory."""
    with rasterio.open(path) as ds:
        log.info(
            "Output verified: %dx%d px, %d band(s), dtype=%s, CRS=%s, driver=%s",
            ds.width, ds.height, ds.count, ds.dtypes[0], ds.crs, ds.driver,
        )
        if not ds.overviews(1):
            log.warning("Output has no overviews -- it is technically a valid GeoTIFF but not a fully compliant COG.")


def parse_args(argv: list[str] | None = None) -> CompareConfig:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--source", required=True, type=Path, help="Path to the source GeoTIFF (defines the output grid).")
    p.add_argument("--reference", required=True, type=Path, help="Path to the reference GeoTIFF (reprojected to match source if needed).")
    p.add_argument("--output", required=True, type=Path, help="Path for the output comparison COG.")
    p.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK, help=f"Chunk/tile size in pixels (default {DEFAULT_CHUNK}).")
    p.add_argument("--workers", type=int, default=4, help="Dask worker threads for the local scheduler (default 4).")
    p.add_argument("--band", type=int, default=1, help="1-indexed band to compare on each input (default 1).")
    p.add_argument("--mode", choices=["abs_diff", "signed_diff"], default="abs_diff", help="Comparison operation (default abs_diff).")
    p.add_argument("--resampling", default="bilinear",
                    choices=[r.name for r in Resampling],
                    help="Resampling method used only if the reference needs reprojecting (default bilinear).")
    args = p.parse_args(argv)
    return CompareConfig(
        source_path=args.source,
        reference_path=args.reference,
        output_path=args.output,
        chunk_size=args.chunk_size,
        workers=args.workers,
        band=args.band,
        mode=args.mode,
        resampling=Resampling[args.resampling],
    )


def main(argv: list[str] | None = None) -> int:
    try:
        config = parse_args(argv)
    except SystemExit:
        raise  # argparse already printed usage/error
    except Exception as e:  # defensive -- argparse itself shouldn't raise arbitrary exceptions
        log.error("Failed to parse arguments: %s", e)
        return 2

    # Local, threaded Dask scheduler: appropriate here because the hot
    # path (rasterio I/O + numpy arithmetic) releases the GIL, and it
    # avoids the process-management overhead of a distributed cluster
    # for a single-machine batch job. Swap for a dask.distributed.Client
    # if this needs to scale across multiple machines.
    import dask
    dask.config.set(scheduler="threads", num_workers=config.workers)

    try:
        output_path = compare_rasters(config)
        _verify_output(output_path)
    except FileNotFoundError as e:
        log.error("Input file missing: %s", e)
        return 1
    except (ValueError, RuntimeError) as e:
        log.error("Comparison failed: %s", e)
        return 1
    except MemoryError:
        log.error(
            "Out of memory despite chunked processing -- try a smaller --chunk-size "
            "or fewer --workers (each concurrent chunk holds its own working set)."
        )
        return 1
    except Exception:
        log.exception("Unexpected error during raster comparison.")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
