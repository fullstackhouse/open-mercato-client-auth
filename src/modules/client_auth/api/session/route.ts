import { handleSession } from '../session-handlers.js'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(req: Request) {
  return handleSession(req)
}
