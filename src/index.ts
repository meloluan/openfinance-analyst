#!/usr/bin/env node
import { main } from './mcp/server.js'

main().catch((err: unknown) => {
  // stdout é do protocolo MCP; erro vai para stderr.
  // Só a mensagem, nunca o objeto inteiro — exceção de SDK pode carregar credencial.
  console.error(err instanceof Error ? err.message : 'Falha ao iniciar o openfinance-analyst.')
  process.exit(1)
})
