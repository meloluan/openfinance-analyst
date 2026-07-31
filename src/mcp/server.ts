import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { mkdirSync } from 'node:fs'
import { loadConfig } from '../config.js'
import { PluggyGateway } from '../pluggy/client.js'
import { getOrCreateKey } from '../store/key.js'
import { openDb } from '../store/db.js'
import { Repo } from '../store/repo.js'
import { registerTools } from './tools.js'

export async function main(): Promise<void> {
  const config = loadConfig()

  // 0o700: só o dono lê. O banco herda a proteção do diretório.
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })

  const repo = new Repo(openDb(config.dbPath, getOrCreateKey()))
  const gateway = new PluggyGateway(config.clientId, config.clientSecret)

  const server = new McpServer({ name: 'openfinance-analyst', version: '1.0.0' })
  registerTools(server, { repo, gateway, declaredItemIds: config.itemIds })

  await server.connect(new StdioServerTransport())
}
