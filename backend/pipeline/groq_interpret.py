"""Real-time plain-language interpretation of real pipeline metrics via the
Groq API (llama-3.3-70b-versatile) -- never a source of new scientific
claims, only a restatement of numbers this pipeline already computed.

GROQ_API_KEY is read from the environment only (never hardcoded, never
sent to the frontend) -- this module is the ONLY place that touches it.
If the key is unset or the call fails for any reason (network, rate
limit, bad key), this returns a clean "unavailable" result rather than
raising -- the rest of the app must keep working with or without Groq.
"""
from __future__ import annotations

import logging
import os

import requests

logger = logging.getLogger(__name__)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
# llama-3.3-70b-versatile (the model originally specified for this feature)
# has been removed from Groq's real, currently-served model lineup --
# confirmed directly against this account's own GROQ_API_KEY via GET
# /openai/v1/models, which returns no llama-3.3 variant at all; calling it
# returns a real 404 "model_not_found". openai/gpt-oss-120b is the closest
# real available substitute for this task (fast, ~1s real measured
# latency, general-purpose instruction-following) -- verified with a real
# sample interpretation before adopting: correctly stated an UNVALIDATED
# result plainly, cited the actual real numbers given, did not soften the
# failure or add unsupported claims.
GROQ_MODEL = "openai/gpt-oss-120b"
REQUEST_TIMEOUT_S = 12

SYSTEM_PROMPT = (
    "You are interpreting real pipeline metrics from a lunar image "
    "registration system. Your job is to explain what the numbers mean "
    "in plain language — what happened, why, and what it implies. "
    "Speak in 2-4 sentences. Be direct and honest. Do NOT add any "
    "scientific information not present in the metrics provided to you. "
    "Do NOT speculate about things not in the data. Do NOT say "
    "'it seems' or 'perhaps' — state what the numbers show, not guesses."
)


def _na(v, fmt: str | None = None, unit: str = "") -> str:
    """Real, honest 'not available' marker for any field this project
    genuinely doesn't have for a given run -- passed to Groq explicitly so
    it says "not available", never a fabricated number. `unit` (e.g. deg
    symbol, "px", "m") is only appended when a real value is present --
    "not available°" reads as a bug, not as "not available"."""
    if v is None:
        return "not available"
    return f"{format(v, fmt) if fmt else v}{unit}"


def build_prompt(call_type: int, fields: dict) -> str:
    if call_type == 1:
        return (
            f"Detection stage results: {fields.get('matcher_used', 'the matcher')} found "
            f"{fields.get('keypoints_source')} keypoints on the {fields.get('source_sensor', 'source')} "
            f"image and {fields.get('keypoints_reference')} keypoints on the "
            f"{fields.get('reference_sensor', 'reference')} image, producing "
            f"{fields.get('candidate_matches')} candidate matches before geometric verification. "
            f"Interpret these numbers plainly."
        )
    if call_type == 2:
        return (
            f"Geometric verification results: {fields.get('candidate_matches')} candidate matches "
            f"were filtered to {fields.get('inlier_count')} inliers ({fields.get('outlier_count')} rejected). "
            f"Inlier ratio: {_na(fields.get('inlier_ratio'), '.2f')} (threshold: 0.5). "
            f"Rotation consistency std: {_na(fields.get('rotation_consistency_std'), '.1f', '°')} "
            f"(threshold: {fields.get('rotation_consistency_threshold', 15.0)}°). "
            f"Homography condition ratio: {_na(fields.get('condition_ratio'), '.2f')}:1 "
            f"(threshold: {fields.get('condition_ratio_threshold', 5.0)}:1). "
            f"Interpret what these numbers show about whether the matches are genuine "
            f"correspondences or false matches."
        )
    if call_type == 3:
        verdict = "VALIDATED" if fields.get("validated") else "UNVALIDATED"
        pu = fields.get("positional_uncertainty_metres")
        return (
            f"Registration result: {verdict}. "
            f"Metrics: {fields.get('inlier_count')} inliers, inlier ratio {_na(fields.get('inlier_ratio'), '.2f')}, "
            f"rotation consistency std {_na(fields.get('rotation_consistency_std'), '.1f', '°')}, "
            f"condition ratio {_na(fields.get('condition_ratio'), '.2f')}:1, "
            f"RMSE {_na(fields.get('rmse_px'), '.3f', 'px')}, "
            f"estimated positional uncertainty "
            f"{_na(pu, '.1f', 'm') if pu is not None else 'not available (no real ground-sample-distance for this pair)'}. "
            f"Sensors: {fields.get('source_sensor', 'unknown')} vs {fields.get('reference_sensor', 'unknown')}. "
            f"Sun angle (source): {_na(fields.get('sun_angle_source'), '.1f', '°')}. "
            f"Sun angle (reference): {_na(fields.get('sun_angle_reference'), '.1f', '°')}. "
            f"Failing thresholds: {fields.get('failing_thresholds') or 'none'}. "
            f"Explain in plain language what this result means, why it passed or failed, and what "
            f"the positional uncertainty implies for practical use (say so plainly if it isn't available)."
        )
    if call_type == 4:
        sun_delta = fields.get("this_pair_sun_delta")
        if sun_delta is not None:
            sun_delta_str = f"{sun_delta:.1f}°"
        else:
            sun_delta_str = (
                "not available (real sun angle metadata is only recorded for this "
                "project's own Chandrayaan-2 frames, not always both sides of a pair)"
            )
        actual_verdict = "VALIDATED" if fields.get("actual_validated") else "UNVALIDATED"
        return (
            f"Invariance analysis for this image pair: sun-angle invariance limit is "
            f"{fields.get('sun_angle_invariance_limit')}°, scale invariance holds across "
            f"{fields.get('scale_invariance_range')}, rotation result: {fields.get('rotation_result')}. "
            f"This specific pair has a sun-angle difference of {sun_delta_str} and scale ratio of "
            f"{_na(fields.get('this_pair_scale_ratio'), '.2f')}x. "
            f"This pair's ACTUAL real registration result was: {actual_verdict}. "
            f"Interpret whether this pair's sun-angle/scale values fall within the pipeline's measured "
            f"invariance limits, and relate that to the actual {actual_verdict} result -- do NOT state or "
            f"imply the result is valid/expected-to-pass if the actual result above says UNVALIDATED, and "
            f"do not imply it failed if the actual result says VALIDATED."
        )
    if call_type == 5:
        mic = fields.get("mean_inlier_confidence")
        moc = fields.get("mean_outlier_confidence")
        return (
            f"Match confidence distribution: {fields.get('inlier_count')} inliers with mean confidence "
            f"{_na(mic, '.2f') if mic is not None else 'not available (no confidence score for any inlier)'}, "
            f"{fields.get('outlier_count')} outliers with mean confidence "
            f"{_na(moc, '.2f') if moc is not None else 'not available (no confidence score for any outlier)'}. "
            f"Interpret what this split implies: whether outliers were rejected despite the matcher being "
            f"confident about them (a sign of visually similar but geometrically wrong matches), or whether "
            f"outliers were already low-confidence before geometric verification."
        )
    raise ValueError(f"Unknown call_type: {call_type}")


def interpret(call_type: int, fields: dict) -> dict:
    """Returns {"available": True, "text": "..."} on success, or
    {"available": False} on any failure -- caller shows a placeholder,
    never an error, never crashes. Full error detail is logged server-side
    only, never returned to the client."""
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        logger.info("GROQ_API_KEY not set -- interpretation unavailable (call_type=%s)", call_type)
        return {"available": False}

    try:
        prompt = build_prompt(call_type, fields)
    except ValueError as exc:
        logger.warning("groq_interpret: %s", exc)
        return {"available": False}

    try:
        resp = requests.post(
            GROQ_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": GROQ_MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
                # 220 was too tight for openai/gpt-oss-120b -- confirmed via a
                # real call that cut off mid-sentence ("...visually plausible
                # matches that"). 500 gives real headroom for a genuine 2-4
                # sentence answer; length is still controlled by the system
                # prompt's own instruction, this is just the safety ceiling.
                "max_tokens": 500,
            },
            timeout=REQUEST_TIMEOUT_S,
        )
        resp.raise_for_status()
        data = resp.json()
        text = data["choices"][0]["message"]["content"].strip()
        return {"available": True, "text": text}
    except Exception as exc:  # noqa: BLE001 -- any failure degrades gracefully, never crashes the endpoint
        logger.warning("Groq interpretation call failed (call_type=%s): %s", call_type, exc)
        return {"available": False}
