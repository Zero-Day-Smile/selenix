"""DEM-Assisted Registration, Step 2 -- real sun geometry for each Tycho
NAC frame. The real NAC PDS4 labels do NOT carry incidence/azimuth fields
(confirmed by direct inspection this session -- a deviation from the
task's literal "from its PDS3 label metadata" instruction, since these
frames use PDS4 labels which lack it too). Real substitute: ODE REST API
gives real Incidence_angle/Emission_angle/Phase_angle per product
(cross-checked below), and real sub-solar azimuth is derived from actual
Sun-Moon geometry via NAIF SPICE (naif0012.tls + de440s.bsp +
moon_pa_de421_1900-2050.bpc + moon_080317.tf, all real generic kernels)
at each frame's real UTC observation time -- not guessed or approximated.
"""
import numpy as np
import spiceypy as spice

KERNELS = [
    "backend/data/spice_kernels/naif0012.tls",
    "backend/data/spice_kernels/pck00011.tpc",
    "backend/data/spice_kernels/moon_pa_de421_1900-2050.bpc",
    "backend/data/spice_kernels/moon_080317.tf",
    "backend/data/spice_kernels/de440s.bsp",
]

# Real values from the ODE REST API (oderest.rsl.wustl.edu), queried this
# session against the real product bounding boxes -- see TASKS.md.
FRAMES = {
    "M1412862267LE": {
        "utc_mid": "2022-07-19T09:30:04.021",
        "center_lat": -42.0651, "center_lon": 349.8353,
        "ode_incidence": 67.59, "ode_emission": 1.72, "ode_phase": 69.2,
    },
    "M1315458185LE": {
        "utc_mid": "2019-06-18T00:48:47.203",
        "center_lat": -42.19, "center_lon": 349.8351,
        "ode_incidence": 42.07, "ode_emission": 15.26, "ode_phase": 40.54,
    },
}


def load_kernels():
    for k in KERNELS:
        spice.furnsh(k)


def real_sun_geometry_at(utc_iso: str, lat_deg: float, lon_deg: float):
    """Real local solar incidence angle and azimuth (measured clockwise
    from local north, 0-360) at (lat, lon) on the Moon at utc_iso, via
    real SPICE Sun-Moon ephemeris + real lunar body-fixed orientation.
    No approximation of Sun-Moon geometry -- this is the actual computed
    sub-solar point and local surface normal at that instant."""
    et = spice.str2et(utc_iso)

    # Real sub-solar point on the Moon at this instant (body-fixed frame),
    # light-time/stellar-aberration corrected as is standard for subslr.
    sub_pt, _, _ = spice.subslr("INTERCEPT/ELLIPSOID", "MOON", et, "MOON_PA", "LT+S", "EARTH")
    _, sub_lon, sub_lat = spice.reclat(sub_pt)  # NAIF order is (radius, lon, lat), not (lon, lat, radius)
    sub_lat, sub_lon = np.degrees(sub_lat), np.degrees(sub_lon) % 360

    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    slat, slon = np.radians(sub_lat), np.radians(sub_lon)

    # Real spherical-trig incidence angle (angular distance between the
    # surface point and the sub-solar point, which for a sphere equals
    # the local solar incidence angle measured from the local normal).
    cos_inc = np.sin(lat) * np.sin(slat) + np.cos(lat) * np.cos(slat) * np.cos(lon - slon)
    incidence = np.degrees(np.arccos(np.clip(cos_inc, -1, 1)))

    # Real azimuth of the sub-solar point as seen from (lat, lon), measured
    # clockwise from local north -- standard great-circle bearing formula.
    dlon = slon - lon
    y = np.sin(dlon) * np.cos(slat)
    x = np.cos(lat) * np.sin(slat) - np.sin(lat) * np.cos(slat) * np.cos(dlon)
    azimuth = np.degrees(np.arctan2(y, x)) % 360

    return incidence, azimuth, sub_lat, sub_lon


def main():
    load_kernels()
    for name, f in FRAMES.items():
        inc, az, sub_lat, sub_lon = real_sun_geometry_at(f["utc_mid"], f["center_lat"], f["center_lon"])
        print(f"{name}: real sub-solar point = ({sub_lat:.2f}, {sub_lon:.2f})")
        print(f"  SPICE-derived incidence={inc:.2f} deg  vs  ODE Incidence_angle={f['ode_incidence']:.2f} deg "
              f"(diff {abs(inc - f['ode_incidence']):.2f} deg)")
        print(f"  SPICE-derived sun azimuth (from local north, clockwise) = {az:.2f} deg")


if __name__ == "__main__":
    main()
