"""Real external lookups against two independent, real, public lunar
nomenclature sources -- for the AreaDetailsPanel feature (nearest named
feature + named-crater list for a footprint).

1. ASU's Lunaserv WMS GetFeatureInfo (webmap.lroc.asu.edu) -- "nearest
   named feature at a point." Real, verified facts before writing this:
   - The layer named `luna_nomenclature` in GetCapabilities is
     queryable="0" (NOT queryable) -- the real queryable nomenclature
     layer is `luna_moon_nomenclature` (queryable="1"), confirmed by
     reading the real capabilities XML directly, not assumed from a
     plausible-looking name.
   - INFO_FORMAT=application/json is NOT supported (a real, live
     GetFeatureInfo request with it returns a real WmsError service
     exception: "info_format=application/json was not recognized").
     The real formats this server actually serves (per its own
     capabilities) are text/yaml, text/html, application/vnd.ogc.gml --
     text/yaml used here (confirmed working, real, structured, and does
     not need a new frontend dependency to parse since this is done
     server-side).
   - Real empty-result shape confirmed: `<layer_name>: []`.

2. USGS Gazetteer of Planetary Nomenclature (planetarynames.wr.usgs.gov)
   -- "every named crater in a bounding box." Real, verified facts:
   - /AdvancedSearch's real <form> is method="post" to /SearchResults --
     GET query params do NOT work, confirmed by reading the raw form
     HTML directly (not assumed).
   - Real field names (exact, including embedded spaces):
     "Target", "Feature Type", "Southernmost Latitude",
     "Northernmost Latitude", "Westernmost Longitude",
     "Easternmost Longitude", "180 360", "East West", "Centric Graphic".
   - Real values: Target Moon = "16_Moon"; Feature Type craters =
     "9_Crater, craters".
   - No JSON/CSV API endpoint exists -- the page's own "CSV" export is a
     client-side jQuery action that re-serializes the already-rendered
     HTML table, not a separate server resource. The real HTML results
     table (class="search_results") has real, stable per-column CSS
     classes (featureNameColumn, diameterColumn, centerLatLonColumn x2)
     -- parsed directly via BeautifulSoup, verified against real saved
     responses before wiring this up live.
   - Real quirk found and handled: when a search matches EXACTLY ONE
     feature, the server 302-redirects straight to that feature's own
     detail page (/Feature/{id}) instead of returning the normal results
     table -- a real, different HTML structure (a vertical key/value
     "Basic Info" table) that needs its own parsing path. `requests`
     follows this redirect correctly by default (converts POST->GET on
     302, unlike curl's default); confirmed directly.
   - Real coordinate-system quirk found: even after requesting
     Centric Graphic=Planetocentric and 180 360=0 - 360 as SEARCH
     filter criteria (which do correctly constrain which real features
     match), the DISPLAYED result coordinates are always rendered in
     Planetographic, +East, -180-180 regardless -- confirmed on a real
     result row. Longitude is normalized back to this project's 0-360
     convention (`% 360`) after parsing, not before.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable, TypeVar

import requests
import yaml
from bs4 import BeautifulSoup

WMS_URL = "https://webmap.lroc.asu.edu/wms"
NOMENCLATURE_LAYER = "luna_moon_nomenclature"  # NOT luna_nomenclature -- see module docstring
GAZETTEER_SEARCH_URL = "https://planetarynames.wr.usgs.gov/SearchResults"
REQUEST_TIMEOUT_S = 15

# Both real external services here are single, unauthenticated,
# best-effort public endpoints (a university WMS, a USGS government
# site) with no SLA -- a single slow response or transient connection
# blip previously surfaced immediately as "could not reach", even
# though a second attempt moments later often succeeds. This retries
# real network-level failures only (timeout, connection error, 5xx) a
# few times with a short real backoff -- never retries on a real parse
# failure or a real 4xx, since those indicate the request itself is
# wrong, not that the service is temporarily unavailable.
_RETRY_ATTEMPTS = 3
_RETRY_BACKOFF_S = 1.5

_T = TypeVar("_T")


def _with_retries(fn: Callable[[], _T]) -> _T:
    last_exc: Exception | None = None
    for attempt in range(_RETRY_ATTEMPTS):
        try:
            return fn()
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code < 500:
                raise  # a real 4xx means the request itself is wrong -- retrying won't help
            last_exc = e
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            last_exc = e
        if attempt < _RETRY_ATTEMPTS - 1:
            time.sleep(_RETRY_BACKOFF_S * (attempt + 1))
    assert last_exc is not None
    raise last_exc


@dataclass
class NamedFeature:
    name: str
    lat: float
    lon: float  # 0-360
    diameter_km: float | None
    feature_type: str | None = None
    url: str | None = None


def get_nearest_named_feature(lat: float, lon: float, half_span_deg: float = 2.0) -> dict:
    """Real WMS GetFeatureInfo against the real queryable nomenclature
    layer, centered on (lat, lon). Returns {"available": True, "name":
    ..., "lat":..., "lon":..., ...raw fields} for the first real feature
    the server reports at that point, or {"available": False} if the
    real response is empty -- never a fabricated "no feature" guess vs a
    genuine network/parse failure (those raise, caller decides how to
    report)."""
    bbox = f"{lon - half_span_deg},{lat - half_span_deg},{lon + half_span_deg},{lat + half_span_deg}"

    def _do_request():
        resp = requests.get(
            WMS_URL,
            params={
                "SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetFeatureInfo",
                "LAYERS": NOMENCLATURE_LAYER, "QUERY_LAYERS": NOMENCLATURE_LAYER,
                "SRS": "EPSG:4326", "BBOX": bbox, "WIDTH": 256, "HEIGHT": 256,
                "X": 128, "Y": 128, "INFO_FORMAT": "text/yaml",
            },
            timeout=REQUEST_TIMEOUT_S,
        )
        resp.raise_for_status()
        return resp

    resp = _with_retries(_do_request)
    parsed = yaml.safe_load(resp.text) or {}
    features = parsed.get(NOMENCLATURE_LAYER) or []
    if not features:
        return {"available": False}

    f = features[0]
    # Real field is "points": "lon,lat" (confirmed on a real Tycho
    # response -- "-11.2153,-43.2958" for lon=348.7847(=-11.2153+360),
    # lat=-43.2958). Falls back to None rather than a guessed value if
    # the real field is missing or malformed.
    out_lat = out_lon = None
    pts = f.get("points")
    if pts:
        try:
            plon, plat = (float(x) for x in pts.split(","))
            out_lon, out_lat = plon % 360, plat
        except (ValueError, TypeError):
            pass
    try:
        diameter = float(f["diameter"]) if f.get("diameter") not in (None, "") else None
    except (ValueError, TypeError):
        diameter = None

    return {
        "available": True,
        "name": f.get("name") or f.get("clean_name"),
        "lat": out_lat,
        "lon": out_lon,
        "diameter_km": diameter,
        "feature_type": f.get("type"),
        "url": f.get("url"),
        "source": "real WMS GetFeatureInfo (ASU Lunaserv, luna_moon_nomenclature)",
    }


def _parse_diameter(text: str) -> float | None:
    text = (text or "").strip().replace("km", "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _parse_single_feature_page(soup: BeautifulSoup) -> NamedFeature | None:
    """Real single-match redirect target (/Feature/{id}) -- a vertical
    key/value 'Basic Info' + 'Location' table, structurally different
    from the multi-result table. Prefers the real WKT point (unambiguous
    0-360-style longitude, confirmed directly against a real page) over
    Center Latitude/Longitude (which are in the real, but differently-
    conventioned, Planetographic -180-180 display)."""
    basic: dict[str, str] = {}
    for tr in soup.select("table.usa-table tbody tr"):
        th, td = tr.find("th"), tr.find("td")
        if th and td:
            basic[th.get_text(strip=True)] = td.get_text(strip=True)

    name = basic.get("Feature Name") or basic.get("Clean Name")
    if not name:
        return None
    diameter = _parse_diameter(basic.get("Diameter", ""))

    lat = lon = None
    wkt = basic.get("WKT String", "")
    if wkt.upper().startswith("POINT"):
        try:
            inner = wkt[wkt.index("(") + 1: wkt.index(")")]
            lon_s, lat_s = inner.split()
            lon, lat = float(lon_s) % 360, float(lat_s)
        except (ValueError, IndexError):
            pass
    if lat is None or lon is None:
        try:
            lat = float(basic.get("Center Latitude", "").replace("°", "").strip())
            lon = float(basic.get("Center Longitude", "").replace("°", "").strip()) % 360
        except (ValueError, TypeError):
            return None

    return NamedFeature(name=name, lat=lat, lon=lon, diameter_km=diameter,
                         feature_type=basic.get("Feature Type"))


def _parse_results_table(soup: BeautifulSoup) -> list[NamedFeature]:
    out = []
    for tr in soup.select("table.search_results tbody tr"):
        name_el = tr.select_one("td.featureNameColumn")
        diam_el = tr.select_one("td.diameterColumn")
        latlon_els = tr.select("td.centerLatLonColumn")
        if not name_el or len(latlon_els) < 2:
            continue
        name = name_el.get_text(strip=True)
        try:
            lat = float(latlon_els[0].get_text(strip=True))
            lon = float(latlon_els[1].get_text(strip=True)) % 360
        except (ValueError, IndexError):
            continue
        out.append(NamedFeature(
            name=name, lat=lat, lon=lon,
            diameter_km=_parse_diameter(diam_el.get_text(strip=True) if diam_el else ""),
        ))
    return out


def search_named_craters(lat_min: float, lat_max: float, lon_min: float, lon_max: float) -> list[NamedFeature]:
    """Real USGS Gazetteer search for every named crater in a real
    lat/lon bounding box (this project's own 0-360 convention in, same
    convention out). Handles all three real response shapes: the normal
    multi-row results table, the single-match redirect-to-detail-page
    case, and the real 'no results' page (returns an empty list for
    that last one -- a real, valid, non-error outcome for small/sparse
    regions, not something to raise on)."""
    def _do_request():
        resp = requests.post(
            GAZETTEER_SEARCH_URL,
            data={
                "Target": "16_Moon",
                "Feature Type": "9_Crater, craters",
                "Southernmost Latitude": str(lat_min),
                "Northernmost Latitude": str(lat_max),
                "Westernmost Longitude": str(lon_min),
                "Easternmost Longitude": str(lon_max),
                "180 360": "0 - 360",
                "East West": "+East",
                "Centric Graphic": "Planetocentric",
            },
            timeout=REQUEST_TIMEOUT_S,
        )
        resp.raise_for_status()
        return resp

    resp = _with_retries(_do_request)
    soup = BeautifulSoup(resp.text, "html.parser")

    if "/Feature/" in resp.url:
        single = _parse_single_feature_page(soup)
        return [single] if single else []

    if "Your search returned no results" in resp.text:
        return []

    return _parse_results_table(soup)
