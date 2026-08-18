import {BRIDGE_HOME, configureClaudeRuntime} from '../config/bridge-home.mjs'

configureClaudeRuntime(BRIDGE_HOME)

const sdk = await import('@anthropic-ai/claude-agent-sdk')

export const query = sdk.query
export const deleteSession = sdk.deleteSession
export const forkSession = sdk.forkSession
