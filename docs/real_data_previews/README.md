# Real data previews

Viewable PNG previews of every real Chandrayaan-2 (`chandrayaan2/`) and LRO NAC
(`lro_nac/`) image downloaded and tested this project — generated from the raw
PDS3/PDS4 files via `backend/pipeline/pds_readers.py` + `ingestion.to_uint8()`.

The raw scientific files themselves (`.img`/`.IMG`, multi-hundred-MB to multi-GB
each) are intentionally **not** committed to this repo — see `.gitignore` — these
previews exist so the real data is visually inspectable without needing to
re-download or re-run the pipeline. Full metadata (dimensions, real lat/lon
footprint, confirmed overlap strength, matching results) is in
`docs/real_data_catalog/index.json`.
