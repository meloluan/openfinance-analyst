import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { mkdirSync } from 'node:fs'
import { parseConfig, resolveEnv } from '../config.js'
import { PluggyGateway } from '../pluggy/client.js'
import { getOrCreateKey } from '../store/key.js'
import { getSecret } from '../store/secrets.js'
import { openDb } from '../store/db.js'
import { Repo } from '../store/repo.js'
import { registerTools } from './tools.js'

export async function main(): Promise<void> {
  // Env primeiro, Keychain depois — assim MCP e `npm run dash` compartilham fonte.
  const config = parseConfig(resolveEnv(process.env, getSecret))

  // 0o700: só o dono lê. O banco herda a proteção do diretório.
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })

  const repo = new Repo(openDb(config.dbPath, getOrCreateKey()))
  const gateway = new PluggyGateway(config.clientId, config.clientSecret)

  const server = new McpServer({ name: 'openfinance-analyst', version: '1.0.0' })
  registerTools(server, { repo, gateway, declaredItemIds: config.itemIds })

  await server.connect(new StdioServerTransport())
}
