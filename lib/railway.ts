/**
 * Railway API Helper — On-Demand Worker Management
 *
 * Uses Railway's GraphQL API to redeploy the video export worker
 * only when an export job is dispatched. This prevents the worker
 * from idling and burning Redis commands.
 */

const RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2'

/**
 * Triggers a redeploy of the Railway worker service.
 * This wakes the worker up to process queued jobs.
 * If it's already running, Railway will handle the redeploy gracefully.
 */
export async function wakeRailwayWorker(): Promise<void> {
  const token = process.env.RAILWAY_API_TOKEN
  const serviceId = process.env.RAILWAY_WORKER_SERVICE_ID
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID

  if (!token || !serviceId || !environmentId) {
    console.warn(
      '[Railway] Missing env vars (RAILWAY_API_TOKEN, RAILWAY_WORKER_SERVICE_ID, RAILWAY_ENVIRONMENT_ID). Skipping worker wake.'
    )
    return
  }

  const mutation = `
    mutation serviceInstanceRedeploy($serviceId: String!, $environmentId: String!) {
      serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
    }
  `

  try {
    const res = await fetch(RAILWAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: mutation,
        variables: { serviceId, environmentId },
      }),
    })

    const data = await res.json()

    if (data.errors) {
      console.error('[Railway] API error:', JSON.stringify(data.errors))
    } else {
      console.log('[Railway] ✅ Worker redeploy triggered')
    }
  } catch (err) {
    // Non-fatal: the job is already in the queue, worker might already be running
    console.error('[Railway] Failed to wake worker (non-fatal):', err)
  }
}
