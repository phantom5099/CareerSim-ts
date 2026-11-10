Deno.serve((request: Request): Response => {
  const url = new URL(request.url)

  if (url.pathname.endsWith('/health')) {
    return Response.json({ ok: true, service: 'careersim-ts' })
  }

  return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
})
