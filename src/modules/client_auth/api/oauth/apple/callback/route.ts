import { handleOauthCallback } from '../../lib.js'

export const metadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
}

export async function GET(req: Request) {
  return handleOauthCallback('apple', req)
}

export async function POST(req: Request) {
  return handleOauthCallback('apple', req)
}
