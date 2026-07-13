import { handleLogin } from '../session-handlers.js'

export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(req: Request) {
  return handleLogin(req)
}
