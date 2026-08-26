const BASE = '/api'

export async function runRegistration({ source, reference, matcher, illumMode, sensorType }) {
  const fd = new FormData()
  for (const f of source) fd.append('source', f)
  for (const f of reference) fd.append('reference', f)
  fd.append('matcher', matcher)
  fd.append('illum_mode', illumMode)
  fd.append('sensor_type', sensorType)
  const res = await fetch(`${BASE}/run`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`Run failed (${res.status})`)
  return res.json()
}

export async function getHistory(sensorType, limit = 200) {
  const q = new URLSearchParams()
  if (sensorType) q.set('sensor_type', sensorType)
  q.set('limit', limit)
  const res = await fetch(`${BASE}/history?${q}`)
  return res.json()
}

export async function getSensorSummary() {
  const res = await fetch(`${BASE}/sensor_summary`)
  return res.json()
}

export async function getHardcases() {
  const res = await fetch(`${BASE}/hardcases`)
  return res.json()
}

export async function runHardcase(id, matcher = 'auto') {
  const res = await fetch(`${BASE}/hardcases/${id}/run?matcher=${matcher}`, { method: 'POST' })
  if (!res.ok) throw new Error(`Hard-case run failed (${res.status})`)
  return res.json()
}

export function runFileUrl(runId, filename) {
  return `${BASE}/runs/${runId}/${filename}`
}

export async function getMatchPoints(runId) {
  const res = await fetch(runFileUrl(runId, 'match_points.json'))
  return res.json()
}

export async function prepareManual({ source, reference, illumMode }) {
  const fd = new FormData()
  for (const f of source) fd.append('source', f)
  for (const f of reference) fd.append('reference', f)
  fd.append('illum_mode', illumMode)
  const res = await fetch(`${BASE}/prepare_manual`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`Prepare failed (${res.status})`)
  return res.json()
}

export async function runManual({ prepId, seedPoints, sensorType }) {
  const fd = new FormData()
  fd.append('prep_id', prepId)
  fd.append('seed_points', JSON.stringify(seedPoints))
  fd.append('sensor_type', sensorType)
  const res = await fetch(`${BASE}/run_manual`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`Manual run failed (${res.status})`)
  return res.json()
}
